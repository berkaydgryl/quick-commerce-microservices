package httpapi

import (
	"bytes"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Kurye takibi ucunun hata yollari (#179): her cevap (hata dahil) no-store,
// butun 404'ler ayni, 500 ve courier hatasi gunluge koordinat ya da ad
// yazmaz, hiz siniri kullanici basina, courier cagrisi son tarih ve
// korelasyon kimligi tasir.

// courierNotFound, courier'in is hatasi (x-app-error NOT_FOUND): kendi
// ayrintisi ve mesajinda kurye adi.
func courierNotFound() *trackingCourier {
	return &trackingCourier{
		err: status.Error(codes.NotFound, "Mehmet Kaya icin rota yok"),
		trailer: metadata.Pairs(apperror.MetadataKey, `{"code":"NOT_FOUND","message":"Mehmet Kaya icin rota yok",`+
			`"details":{"orderId":"`+testOrderID+`","courierId":"crr_0123456789abcdef0123456789abcdef"}}`),
	}
}

// courierBreaksContract, rotasi kuryenin onceki musterisinin konumuyla
// baslayan cevap (N1): istemciye gitmez, 500 olur.
func courierBreaksContract() *trackingCourier {
	response := onTheWay()
	response.Route = append([]*commonv1.GeoPoint{{Lat: trackingLat, Lng: trackingLng}}, response.GetRoute()...)
	return &trackingCourier{response: response}
}

func TestOrderTrackingIsNeverCached(t *testing.T) {
	// Konum kisisel veri: no-store rotanin ILK ara katmaninda, hata cevaplari
	// (kimlik, dogrulama, 404, 500, 503) dahil.
	for _, tc := range []struct {
		name    string
		orders  *trackedOrders
		courier *trackingCourier
		path    string
		headers map[string]string
		status  int
	}{
		{name: "200", orders: &trackedOrders{status: "ON_THE_WAY"}, courier: &trackingCourier{}, status: http.StatusOK},
		{name: "400 bilinmeyen sorgu", orders: &trackedOrders{status: "ON_THE_WAY"}, courier: &trackingCourier{}, path: trackingPath() + "?userId=usr_baska", status: http.StatusBadRequest},
		{name: "401 kimliksiz", orders: &trackedOrders{status: "ON_THE_WAY"}, courier: &trackingCourier{}, headers: map[string]string{fiber.HeaderAuthorization: ""}, status: http.StatusUnauthorized},
		{name: "404 bicimsiz kimlik", orders: &trackedOrders{status: "ON_THE_WAY"}, courier: &trackingCourier{}, path: "/v1/orders/ord_1/tracking", status: http.StatusNotFound},
		{name: "404 baskasinin siparisi", orders: &trackedOrders{err: apperror.New(apperror.CodeNotFound, map[string]string{"orderId": testOrderID})}, courier: &trackingCourier{}, status: http.StatusNotFound},
		{name: "404 courier x-app-error", orders: &trackedOrders{status: "ON_THE_WAY"}, courier: courierNotFound(), status: http.StatusNotFound},
		{name: "500 sozlesmeye aykiri", orders: &trackedOrders{status: "ON_THE_WAY"}, courier: courierBreaksContract(), status: http.StatusInternalServerError},
		{name: "503 order kapali", orders: &trackedOrders{err: &apperror.Error{Code: apperror.CodeServiceUnavailable}}, courier: &trackingCourier{}, status: http.StatusServiceUnavailable},
		{name: "503 courier kapali", orders: &trackedOrders{status: "ON_THE_WAY"}, courier: &trackingCourier{err: status.Error(codes.Unavailable, "baglanti yok")}, status: http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := tc.path
			if path == "" {
				path = trackingPath()
			}
			app := trackingApp(tc.orders, tc.courier, silentLogger())

			got, header, _ := exchange(t, app, trackingRequest(t, path, tc.headers))

			if got != tc.status {
				t.Fatalf("%d bekleniyordu: %d", tc.status, got)
			}
			if header.Get(fiber.HeaderCacheControl) != noStore {
				t.Errorf("no-store bekleniyordu: %q", header.Get(fiber.HeaderCacheControl))
			}
		})
	}
}

func TestOrderTrackingIsRateLimitedPerUser(t *testing.T) {
	// Sayac KULLANICI basina (generalByUser): ayni IP'den ikinci kullanici
	// sinirlanmaz.
	courier := &trackingCourier{}
	app := trackingApp(&trackedOrders{status: "ON_THE_WAY"}, courier, silentLogger(), func(deps *Deps) {
		deps.RateLimit = memoryLimits(newTestClock(), 1, 10, 10)
	})

	first, _, _ := exchange(t, app, trackingRequest(t, trackingPath(), nil))
	second, header, envelope := exchange(t, app, trackingRequest(t, trackingPath(), nil))
	other, _, _ := exchange(t, app, trackingRequest(t, trackingPath(), bearerFor(t, "usr_fedcba9876543210fedcba9876543210")))

	if first != http.StatusOK || second != http.StatusTooManyRequests || envelope.Error == nil || envelope.Error.Code != apperror.CodeRateLimited {
		t.Fatalf("200 sonra 429 bekleniyordu: %d %d %+v", first, second, envelope)
	}
	if header.Get(fiber.HeaderCacheControl) != noStore {
		t.Errorf("429 da no-store olmali: %q", header.Get(fiber.HeaderCacheControl))
	}
	if other != http.StatusOK {
		t.Errorf("baska kullanici sinirlanmamali: %d", other)
	}
	if courier.calls != 2 {
		t.Errorf("sinirlanan istek courier'e gitmemeli: %d cagri", courier.calls)
	}
}

func TestOrderTrackingNotFoundBodiesAreTheSame(t *testing.T) {
	// Sahiplik (order), durum ve courier'in is hatasi (kendi ayrintisiyla)
	// disaridan ayirt edilemez: kod, mesaj ve ayrinti ayni.
	var bodies []APIError
	for _, setup := range []struct {
		orders  *trackedOrders
		courier *trackingCourier
	}{
		{orders: &trackedOrders{err: apperror.New(apperror.CodeNotFound, map[string]string{"orderId": testOrderID})}, courier: &trackingCourier{}},
		{orders: &trackedOrders{status: "CANCELLED"}, courier: &trackingCourier{}},
		{orders: &trackedOrders{status: "ON_THE_WAY"}, courier: courierNotFound()},
	} {
		got, envelope := send(t, trackingApp(setup.orders, setup.courier, silentLogger()), trackingRequest(t, trackingPath(), nil))
		if got != http.StatusNotFound || envelope.Error == nil {
			t.Fatalf("404 bekleniyordu: %d %+v", got, envelope)
		}
		body := *envelope.Error
		body.RequestID = ""
		bodies = append(bodies, body)
	}
	for _, body := range bodies[1:] {
		if body.Code != bodies[0].Code || body.Message != bodies[0].Message || testkit.JSON(t, body.Details) != testkit.JSON(t, bodies[0].Details) {
			t.Errorf("404 govdeleri ayni olmali:\n%+v\n%+v", bodies[0], body)
		}
	}
	if testkit.JSON(t, bodies[0].Details) != `{"orderId":"`+testOrderID+`"}` {
		t.Errorf("ayrinti yalnizca orderId: %s", testkit.JSON(t, bodies[0].Details))
	}
}

func TestOrderTrackingCourierCallCarriesDeadlineAndRequestID(t *testing.T) {
	courier := &trackingCourier{}
	app := trackingApp(&trackedOrders{status: "ON_THE_WAY"}, courier, silentLogger())

	got, _ := send(t, app, trackingRequest(t, trackingPath(), map[string]string{RequestIDHeader: testRequestID}))

	if got != http.StatusOK || courier.ctx == nil || courier.request.GetOrderId() != testOrderID {
		t.Fatalf("courier siparis kimligiyle cagrilmali: %d %+v", got, courier.request)
	}
	// tracking.New(..., time.Second): cagri basina son tarih. Butce cagri
	// ANINDA olculur (son tarih ile cagri ayni goroutine'de, arada RPC yok):
	// en cok 1 sn, cok kisa bir sure (ornegin 1 ms) de yakalanir.
	if courier.budget <= time.Second/2 || courier.budget > time.Second {
		t.Errorf("courier cagrisi 1 sn son tarih tasimali: kalan %v", courier.budget)
	}
	outgoing, _ := metadata.FromOutgoingContext(courier.ctx)
	if values := outgoing.Get(requestIDMetadataKey); len(values) != 1 || values[0] != testRequestID {
		t.Errorf("korelasyon kimligi courier'e tasinmali: %v", values)
	}
}

func TestOrderTrackingErrorsLogNoCoordinatesOrName(t *testing.T) {
	// 500 (aykiri cevap koordinat tasir) ve courier'in 404'u (mesajinda ad):
	// gunlukte ne koordinat ne kurye adi.
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	broken := trackingApp(&trackedOrders{status: "ON_THE_WAY"}, courierBreaksContract(), logger)
	missing := trackingApp(&trackedOrders{status: "ON_THE_WAY"}, courierNotFound(), logger)

	brokenStatus, brokenEnvelope := send(t, broken, trackingRequest(t, trackingPath(), nil))
	missingStatus, _ := send(t, missing, trackingRequest(t, trackingPath(), nil))

	if brokenStatus != http.StatusInternalServerError || brokenEnvelope.Data != nil || brokenEnvelope.Error.Details != nil {
		t.Fatalf("ayrintisiz 500 bekleniyordu: %d %+v", brokenStatus, brokenEnvelope)
	}
	if missingStatus != http.StatusNotFound {
		t.Fatalf("404 bekleniyordu: %d", missingStatus)
	}
	if !strings.Contains(logs.String(), `"code":"INTERNAL"`) || !strings.Contains(logs.String(), "rota market -> adres parcasi degil") {
		t.Fatalf("500 nedeni (alan adiyla) gunlukte olmali:\n%s", logs.String())
	}
	for _, leak := range []string{"40.98765", "29.12345", `"lat"`, `"lng"`, "Mehmet", "Kaya"} {
		if strings.Contains(logs.String(), leak) {
			t.Errorf("gunlukte %q var:\n%s", leak, logs.String())
		}
	}
}

func TestOrderTrackingCourierErrorBodyCarriesNoCourierDetails(t *testing.T) {
	// #187: courier'in NOT_FOUND disindaki hatasinin ayrintisi (kurye kimligi,
	// konum, baska siparis) cevaba gecmez; kod ve kendi mesajimiz kalir.
	courier := &trackingCourier{
		err: status.Error(codes.FailedPrecondition, "Mehmet Kaya 41.0082,28.9784"),
		trailer: metadata.Pairs(apperror.MetadataKey, `{"code":"ORDER_STATE_INVALID","message":"Mehmet Kaya",`+
			`"details":{"courierId":"crr_0123456789abcdef0123456789abcdef","location":{"lat":41.0082,"lng":28.9784}}}`),
	}
	app := trackingApp(&trackedOrders{status: "ON_THE_WAY"}, courier, silentLogger())

	got, header, raw := exchangeRaw(t, app, trackingRequest(t, trackingPath(), nil))

	if want := apperror.HTTPStatus(apperror.CodeOrderStateInvalid); got != want {
		t.Fatalf("%d bekleniyordu: %d", want, got)
	}
	body := string(raw)
	for _, secret := range []string{"crr_", "41.0082", "Mehmet", `"details"`} {
		if strings.Contains(body, secret) {
			t.Errorf("cevap courier verisi tasimamali (%s): %s", secret, body)
		}
	}
	if !strings.Contains(body, `"ORDER_STATE_INVALID"`) || header.Get(fiber.HeaderCacheControl) != noStore {
		t.Errorf("kod korunmali ve cevap no-store olmali: %s %q", body, header.Get(fiber.HeaderCacheControl))
	}
}
