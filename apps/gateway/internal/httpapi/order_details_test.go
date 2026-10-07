package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// POST /v1/orders ayrintisi ve kayitli kart (T12.4): kurallar REST adlariyla,
// kisisel veri (ad, telefon, not, mesaj) cevaba, gunluge ve tekrar korumasi
// kaydina YANSIMAZ.

// giftDetailsJSON, kisisel veri tasiyan gecerli ayrinti.
const giftDetailsJSON = `{"gift":{"enabled":true,"message":"Doğum günün kutlu olsun","senderName":"Ayşe Demir",` +
	`"recipientName":"Zeynep Kaya","recipientPhone":"+905321112233"},"note":"Kapı kodu 4417","doNotRingBell":true,"agreementsAccepted":true}`

// personalValues, giftDetailsJSON'daki kisisel veri.
var personalValues = []string{"Doğum günün", "Ayşe Demir", "Zeynep Kaya", "5321112233", "Kapı kodu 4417"}

func placeBodyWith(payment, details string) string {
	return `{"orderId":"` + testOrderID + `","payment":` + payment + `,"details":` + details + `}`
}

const savedCardPayment = `{"method":"CARD","cardId":"` + testCardID + `"}`

func assertNoPersonalData(t *testing.T, where, text string) {
	t.Helper()
	masked := testkit.WithoutRandomNoise(text)
	for _, value := range personalValues {
		if strings.Contains(masked, value) {
			t.Errorf("%s: kisisel veri (%d karakter) bulundu", where, len(value))
		}
	}
}

// detailsApp, gunlugu ve tekrar korumasi deposu verilen siparis uygulamasi.
func detailsApp(orders *fakeOrders, logger *slog.Logger, store idempotency.Store) *fiber.App {
	return New(Deps{
		Health:              fakeReporter{report: healthyReport()},
		CartReserver:        orders,
		ReservationReleaser: orders,
		OrderPlacer:         orders,
		ThreeDSConfirmer:    orders,
		OrderGetter:         orders,
		OrderLister:         orders,
		CheckoutSignals:     &fakeSignals{},
		AccessTokens:        testTokens(),
		Idempotency:         Idempotency{Store: store, FingerprintKey: testFingerprintKey, TTL: 24 * time.Hour},
		Logger:              logger,
	})
}

func rawResponse(t *testing.T, app *fiber.App, request *http.Request) (int, string) {
	t.Helper()
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	raw, err := io.ReadAll(response.Body)
	if closeErr := response.Body.Close(); closeErr != nil {
		t.Errorf("cevap govdesi kapatilamadi: %v", closeErr)
	}
	if err != nil {
		t.Fatalf("cevap okunamadi: %v", err)
	}
	return response.StatusCode, string(raw)
}

func TestPlaceOrderPassesSavedCardAndDetails(t *testing.T) {
	orders := &fakeOrders{}

	status, envelope := send(t, orderApp(orders), orderRequest(t, http.MethodPost, "/v1/orders", placeBodyWith(savedCardPayment, giftDetailsJSON), nil))

	if status != http.StatusCreated {
		t.Fatalf("201 bekleniyordu: %d %+v", status, envelope)
	}
	input := orders.placeInput
	want := order.Details{
		Gift:          &order.Gift{Message: "Doğum günün kutlu olsun", SenderName: "Ayşe Demir", RecipientName: "Zeynep Kaya", RecipientPhone: "+905321112233"},
		Note:          "Kapı kodu 4417",
		DoNotRingBell: true, AgreementsAccepted: true,
	}
	if input.CardID != testCardID || input.CardToken != "" || testkit.JSON(t, input.Details) != testkit.JSON(t, want) {
		t.Errorf("kart ve ayrinti tasinmali: %+v %+v", input, input.Details.Gift)
	}
}

func TestPlaceOrderDetailsAndCardRulesUseRESTFieldNames(t *testing.T) {
	cases := []struct {
		name, body, field, reason string
	}{
		{"ayrinti yok", `{"orderId":"` + testOrderID + `","payment":` + savedCardPayment + `}`, "details", requiredReason},
		{"onay yok", placeBodyWith(savedCardPayment, `{"note":"","doNotRingBell":false,"agreementsAccepted":false}`),
			"details.agreementsAccepted", "Siparişi vermek için sözleşmeleri onayla"},
		{"hediye kapali", placeBodyWith(savedCardPayment, strings.Replace(giftDetailsJSON, `"enabled":true`, `"enabled":false`, 1)),
			"details.gift.enabled", giftEnabledReason},
		{"iki kart", placeBodyWith(`{"method":"CARD","cardId":"`+testCardID+`","cardToken":"tok_test_4242"}`, giftDetailsJSON),
			"payment.cardId", "Ödeme için bir kart seç"},
		{"kart yok", placeBodyWith(`{"method":"CARD"}`, giftDetailsJSON), "payment.cardId", "Ödeme için bir kart seç"},
		// Kimlik bicimi gateway'de (sinyal veritabanina gitmeden): cardIdSchema.
		{"kart kimligi bicimsiz", placeBodyWith(`{"method":"CARD","cardId":"crd_kisa"}`, giftDetailsJSON),
			"payment.cardId", "kart kimligi bekleniyor"},
		// Sozlesmede GONDERILEN alan sayilir: bos kimlik bicimsizdir, "yok" degil.
		{"bos kimlik + jeton", placeBodyWith(`{"method":"CARD","cardId":"","cardToken":"tok_test_4242"}`, giftDetailsJSON),
			"payment.cardId", "kart kimligi bekleniyor"},
		{"bosluk jeton", placeBodyWith(`{"method":"CARD","cardToken":"  "}`, giftDetailsJSON), "payment.cardToken", requiredReason},
		{"zil alani yok", placeBodyWith(savedCardPayment, `{"note":"","agreementsAccepted":true}`), "details.doNotRingBell", requiredReason},
		{"not alani yok", placeBodyWith(savedCardPayment, `{"doNotRingBell":true,"agreementsAccepted":true}`), "details.note", requiredReason},
		{"hediye mesaji yok", placeBodyWith(savedCardPayment, strings.Replace(giftDetailsJSON, `"message":"Doğum günün kutlu olsun",`, "", 1)),
			"details.gift.message", requiredReason},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			orders, signals := &fakeOrders{}, &fakeSignals{}

			status, envelope := send(t, orderAppWithSignals(orders, signals), orderRequest(t, http.MethodPost, "/v1/orders", tc.body, nil))

			if status != http.StatusBadRequest || detailsOf(t, envelope)[tc.field] != tc.reason {
				t.Errorf("400 + %s=%q bekleniyordu: %d %+v", tc.field, tc.reason, status, envelope)
			}
			if orders.called || signals.called {
				t.Error("gecersiz istek servise ve sinyal okuyucuya gitmemeli")
			}
		})
	}
}

func TestInvalidDetailsEchoNoPersonalDataInResponseOrLog(t *testing.T) {
	// PM K2: hatali telefon, uzun ad ve not; tip hatasi (telefon sayi). Cevap
	// yalnizca alan adini ve sabit cumleyi tasir; gunluk (DEBUG dahil) degeri yazmaz.
	var output lockedBuffer
	logger := slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug}))
	app := detailsApp(&fakeOrders{}, logger, idempotency.NewMemory(time.Now))
	longName := strings.Repeat("Zeynep Kaya ", 6)
	bodies := []string{
		placeBodyWith(savedCardPayment, strings.Replace(giftDetailsJSON, `"+905321112233"`, `"05321112233"`, 1)),
		placeBodyWith(savedCardPayment, strings.Replace(giftDetailsJSON, `"Zeynep Kaya"`, `"`+longName+`"`, 1)),
		placeBodyWith(savedCardPayment, strings.Replace(giftDetailsJSON, `"Kapı kodu 4417"`, `"Kapı kodu 4417 `+strings.Repeat("x", 250)+`"`, 1)),
		placeBodyWith(savedCardPayment, strings.Replace(giftDetailsJSON, `"+905321112233"`, `5321112233`, 1)),
	}
	var responses strings.Builder
	for n, body := range bodies {
		status, raw := rawResponse(t, app, orderRequest(t, http.MethodPost, "/v1/orders", body,
			map[string]string{IdempotencyKeyHeader: "anahtar-yanlis-000" + string(rune('1'+n))}))
		if status != http.StatusBadRequest {
			t.Errorf("govde %d: 400 bekleniyordu: %d %s", n, status, raw)
		}
		responses.WriteString(raw)
	}

	for _, field := range []string{`"details.gift.recipientPhone"`, `"details.gift.recipientName"`, `"details.note"`} {
		if !strings.Contains(responses.String(), field) {
			t.Errorf("cevap alan adini gostermeli: %s", field)
		}
	}
	assertNoPersonalData(t, "cevap", responses.String())
	if strings.Count(output.String(), "http istegi") < len(bodies) {
		t.Fatalf("her istek gunlukte bir satir olmali:\n%s", output.String())
	}
	assertNoPersonalData(t, "gunluk", output.String())
}

func TestCheckoutIdempotencyRecordHoldsNoPersonalData(t *testing.T) {
	// PM K3: basarili siparisin kaydi 2 sa yasar. Kayit = sunucu sirriyla HMAC
	// parmak izi + CEVAP govdesi; siparis cevabi (Placement) ayrinti tasimaz.
	var output lockedBuffer
	logger := slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug}))
	store := &recordingIdempotencyStore{inner: idempotency.NewMemory(time.Now)}
	app := detailsApp(&fakeOrders{}, logger, store)
	body := placeBodyWith(savedCardPayment, giftDetailsJSON)

	first, _ := rawResponse(t, app, orderRequest(t, http.MethodPost, "/v1/orders", body, nil))
	replayed, raw := rawResponse(t, app, orderRequest(t, http.MethodPost, "/v1/orders", body, nil))

	if first != http.StatusCreated || replayed != http.StatusCreated {
		t.Fatalf("ilk istek ve tekrari 201 olmali: %d %d", first, replayed)
	}
	records, err := json.Marshal(store.saved)
	if err != nil {
		t.Fatalf("kayitlar: %v", err)
	}
	if len(store.saved) == 0 {
		t.Fatal("kayit yazilmadi")
	}
	assertNoPersonalData(t, "tekrar kaydi", string(records))
	assertNoPersonalData(t, "tekrar cevabi", raw)
	assertNoPersonalData(t, "gunluk", output.String())
}

func TestGetOrderReturnsDetailsToTheOwner(t *testing.T) {
	// T12.4: tek siparis cevabi ayrintiyi tasir (sahiplik order-service'te);
	// onbelleklenmez (no-store, TestGetOrderIsPrivate).
	orders := &fakeOrders{details: &order.DetailsView{
		Gift: &order.GiftView{RecipientName: "Zeynep Kaya", RecipientPhone: "+905321112233"},
		Note: "Kapı kodu 4417", DoNotRingBell: true, AgreementsAccepted: true, AgreementsAcceptedAt: "2026-10-07T12:00:00Z",
	}}

	status, envelope := send(t, orderApp(orders), orderRequest(t, http.MethodGet, "/v1/orders/"+testOrderID, "", nil))

	data, isMap := envelope.Data.(map[string]any)
	if status != http.StatusOK || !isMap {
		t.Fatalf("200 bekleniyordu: %d %+v", status, envelope)
	}
	details, isMap := data["details"].(map[string]any)
	if !isMap || details["note"] != "Kapı kodu 4417" || details["agreementsAcceptedAt"] != "2026-10-07T12:00:00Z" {
		t.Errorf("ayrinti cevapta olmali: %+v", data["details"])
	}
}
