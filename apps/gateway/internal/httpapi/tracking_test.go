package httpapi

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"
	courierv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/courier/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/tracking"
)

// Kurye takibi ucu (T14.2) GERCEK tracking.Service ile; order ve courier sahte.
// Kurallarin ayrintili tablosu internal/tracking'de; burada HTTP sozlesmesi:
// kimlik, yol, durum kodlari, no-store ve gunlukte koordinat yoklugu.

// Konumda kullanilan ayirt edici koordinatlar: gunlukte gorunmemeli.
const (
	trackingLat = 40.98765
	trackingLng = 29.12345
)

// trackedOrders, sahiplik ve durum (order adaptorunun sahtesi).
type trackedOrders struct {
	status  string
	err     error
	userID  string
	orderID string
	ctx     context.Context
	calls   int
}

func (f *trackedOrders) Get(ctx context.Context, userID, orderID string) (order.Order, error) {
	f.calls++
	f.ctx, f.userID, f.orderID = ctx, userID, orderID
	if f.err != nil {
		return order.Order{}, f.err
	}
	return order.Order{ID: orderID, Status: f.status}, nil
}

// trackingCourier, courier istemcisinin sahtesi: cagrinin baglamini ve
// istegini saklar; hata, trailer (x-app-error) ve cevap verilebilir.
type trackingCourier struct {
	err      error
	trailer  metadata.MD
	response *courierv1.GetTrackingResponse
	ctx      context.Context
	request  *courierv1.GetTrackingRequest
	// budget, cagri ANINDA son tarihe kalan sure (yoksa 0).
	budget time.Duration
	calls  int
}

func (f *trackingCourier) GetTracking(ctx context.Context, in *courierv1.GetTrackingRequest, opts ...grpc.CallOption) (*courierv1.GetTrackingResponse, error) {
	f.calls++
	f.ctx, f.request = ctx, in
	if deadline, has := ctx.Deadline(); has {
		f.budget = time.Until(deadline)
	}
	testkit.SetTrailer(opts, f.trailer)
	if f.err != nil {
		return nil, f.err
	}
	if f.response != nil {
		return f.response, nil
	}
	return onTheWay(), nil
}

// onTheWay, paket alinmis takibin courier cevabi. Kurye adi TAM gelir
// (gateway kisaltir, #183); konum ayirt edici koordinatlarla.
func onTheWay() *courierv1.GetTrackingResponse {
	at := timestamppb.New(time.Date(2026, 10, 7, 20, 10, 0, 0, time.UTC))
	return &courierv1.GetTrackingResponse{
		CourierId:        "crr_0123456789abcdef0123456789abcdef",
		CourierName:      "Mehmet Kaya",
		Phase:            courierv1.TrackingPhase_TRACKING_PHASE_TO_CUSTOMER,
		Location:         &commonv1.GeoPoint{Lat: trackingLat, Lng: trackingLng},
		At:               at,
		RemainingMeters:  250,
		EtaSeconds:       60,
		Route:            []*commonv1.GeoPoint{{Lat: 40.99, Lng: 29.02}, {Lat: 40.995, Lng: 29.03}},
		MarketLocation:   &commonv1.GeoPoint{Lat: 40.99, Lng: 29.02},
		DeliveryLocation: &commonv1.GeoPoint{Lat: 40.995, Lng: 29.03},
		PickedUpAt:       at,
	}
}

func trackingApp(orders *trackedOrders, courier *trackingCourier, logger *slog.Logger, adjust ...func(*Deps)) *fiber.App {
	deps := Deps{
		Health:        fakeReporter{report: healthyReport()},
		OrderTracking: tracking.New(orders, courier, time.Second),
		AccessTokens:  testTokens(),
		Logger:        logger,
	}
	for _, change := range adjust {
		change(&deps)
	}
	return New(deps)
}

func trackingPath() string {
	return "/v1/orders/" + testOrderID + "/tracking"
}

func trackingRequest(t *testing.T, path string, headers map[string]string) *http.Request {
	t.Helper()
	merged := map[string]string{IdempotencyKeyHeader: ""}
	for name, value := range headers {
		merged[name] = value
	}
	return orderRequest(t, http.MethodGet, path, "", merged)
}

func TestOrderTrackingForOwner(t *testing.T) {
	orders, courier := &trackedOrders{status: "ON_THE_WAY"}, &trackingCourier{}
	app := trackingApp(orders, courier, silentLogger())

	status, header, envelope := exchange(t, app, trackingRequest(t, trackingPath(), map[string]string{RequestIDHeader: testRequestID}))

	if status != http.StatusOK || !envelope.Success {
		t.Fatalf("200 bekleniyordu: %d %+v", status, envelope)
	}
	if header.Get(fiber.HeaderCacheControl) != noStore {
		t.Errorf("konum kisisel veri: no-store bekleniyordu, %q", header.Get(fiber.HeaderCacheControl))
	}
	if orders.userID != testUserID || orders.orderID != testOrderID {
		t.Errorf("sahiplik jetonun kullanicisi ve yol kimligiyle sorulmali: %q %q", orders.userID, orders.orderID)
	}
	outgoing, _ := metadata.FromOutgoingContext(orders.ctx)
	if got := outgoing.Get(requestIDMetadataKey); len(got) != 1 || got[0] != testRequestID {
		t.Errorf("korelasyon kimligi tasinmali: %v", got)
	}
	data, isObject := envelope.Data.(map[string]any)
	if !isObject {
		t.Fatalf("data nesne olmali: %+v", envelope.Data)
	}
	if data["orderId"] != testOrderID || data["status"] != "ON_THE_WAY" || data["phase"] != "TO_CUSTOMER" {
		t.Errorf("kimlik, durum (order'dan) ve asama (courier'dan): %+v", data)
	}
	if _, hasLocation := data["location"].(map[string]any); !hasLocation {
		t.Errorf("paket alindiktan sonra konum olmali: %+v", data)
	}
	if courier, _ := data["courier"].(map[string]any); courier["name"] != "Mehmet K." {
		t.Errorf("kurye adi kisaltilmali (#183): %+v", data["courier"])
	}
}

func TestOrderTrackingNotFoundAndUnavailable(t *testing.T) {
	for _, tc := range []struct {
		name    string
		orders  *trackedOrders
		courier *trackingCourier
		path    string
		status  int
		code    apperror.Code
	}{
		{name: "baskasinin siparisi", orders: &trackedOrders{err: apperror.New(apperror.CodeNotFound, map[string]string{"orderId": testOrderID})}, courier: &trackingCourier{}, status: http.StatusNotFound, code: apperror.CodeNotFound},
		{name: "iptal edilmis", orders: &trackedOrders{status: "CANCELLED"}, courier: &trackingCourier{}, status: http.StatusNotFound, code: apperror.CodeNotFound},
		{name: "takip yok", orders: &trackedOrders{status: "PREPARING"}, courier: &trackingCourier{err: status.Error(codes.NotFound, "rota yok")}, status: http.StatusNotFound, code: apperror.CodeNotFound},
		{name: "bicimsiz kimlik", orders: &trackedOrders{status: "PREPARING"}, courier: &trackingCourier{}, path: "/v1/orders/ord_1/tracking", status: http.StatusNotFound, code: apperror.CodeNotFound},
		{name: "order kapali", orders: &trackedOrders{err: &apperror.Error{Code: apperror.CodeServiceUnavailable}}, courier: &trackingCourier{}, status: http.StatusServiceUnavailable, code: apperror.CodeServiceUnavailable},
		{name: "courier kapali", orders: &trackedOrders{status: "PREPARING"}, courier: &trackingCourier{err: status.Error(codes.Unavailable, "baglanti yok")}, status: http.StatusServiceUnavailable, code: apperror.CodeServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := tc.path
			if path == "" {
				path = trackingPath()
			}
			app := trackingApp(tc.orders, tc.courier, silentLogger())

			status, envelope := send(t, app, trackingRequest(t, path, nil))

			if status != tc.status || envelope.Error == nil || envelope.Error.Code != tc.code {
				t.Fatalf("%d %s bekleniyordu: %d %+v", tc.status, tc.code, status, envelope)
			}
			if envelope.Data != nil {
				t.Errorf("hata cevabinda takip olmamali: %+v", envelope.Data)
			}
		})
	}
}

func TestOrderTrackingRequiresUser(t *testing.T) {
	orders, courier := &trackedOrders{status: "PREPARING"}, &trackingCourier{}
	app := trackingApp(orders, courier, silentLogger())

	status, envelope := send(t, app, trackingRequest(t, trackingPath(), map[string]string{fiber.HeaderAuthorization: ""}))

	if status != http.StatusUnauthorized || envelope.Error == nil || envelope.Error.Code != apperror.CodeUnauthorized {
		t.Errorf("401 bekleniyordu: %d %+v", status, envelope)
	}
	if orders.calls != 0 || courier.calls != 0 {
		t.Error("kimliksiz istekte servislere gidilmemeli")
	}
}

func TestOrderTrackingRejectsUnknownQuery(t *testing.T) {
	orders, courier := &trackedOrders{status: "PREPARING"}, &trackingCourier{}
	app := trackingApp(orders, courier, silentLogger())

	status, envelope := send(t, app, trackingRequest(t, trackingPath()+"?userId=usr_baska", nil))

	if status != http.StatusBadRequest || envelope.Error == nil || envelope.Error.Code != apperror.CodeValidationFailed {
		t.Errorf("400 bekleniyordu: %d %+v", status, envelope)
	}
	if orders.calls != 0 || courier.calls != 0 {
		t.Error("gecersiz istekte servislere gidilmemeli")
	}
}

func TestOrderTrackingLogsNoCoordinates(t *testing.T) {
	// Konum kisisel veri: istek ve hata gunlugu (DEBUG dahil) koordinat tasimaz.
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	ok := trackingApp(&trackedOrders{status: "ON_THE_WAY"}, &trackingCourier{}, logger)
	down := trackingApp(&trackedOrders{status: "ON_THE_WAY"}, &trackingCourier{err: status.Error(codes.Unavailable, "baglanti yok")}, logger)

	okStatus, _ := send(t, ok, trackingRequest(t, trackingPath(), nil))
	downStatus, _ := send(t, down, trackingRequest(t, trackingPath(), nil))

	if okStatus != http.StatusOK || downStatus != http.StatusServiceUnavailable {
		t.Fatalf("200 ve 503 bekleniyordu: %d %d", okStatus, downStatus)
	}
	if logs.Len() == 0 {
		t.Fatal("istek gunlugu yazilmali (denetim bos gunlukte anlamsiz)")
	}
	for _, leak := range []string{"40.98765", "29.12345", `"lat"`, `"lng"`, "location", "Kaya"} {
		if strings.Contains(logs.String(), leak) {
			t.Errorf("gunlukte %q var:\n%s", leak, logs.String())
		}
	}
}
