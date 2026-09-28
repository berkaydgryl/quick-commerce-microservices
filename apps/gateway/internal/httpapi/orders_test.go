package httpapi

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
	"google.golang.org/grpc/metadata"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
)

const testOrderID = "ord_db77f4c0e24f49919cc1d78a649c9c94"

// fakeOrders, dort siparis ucunun adaptorunun yerine gecer; aldigi girdiyi ve
// baglami saklar ki kimlik, anahtar ve korelasyon kimliginin tasindigi gorulsun.
type fakeOrders struct {
	reserveInput order.ReserveInput
	placeInput   order.PlaceInput
	confirmInput order.ConfirmInput
	getUserID    string
	getOrderID   string
	ctx          context.Context
	called       bool
	err          error
}

func (f *fakeOrders) Reserve(ctx context.Context, input order.ReserveInput) (order.Reservation, error) {
	f.called, f.ctx, f.reserveInput = true, ctx, input
	return order.Reservation{OrderID: testOrderID, Status: "DRAFT"}, f.err
}

func (f *fakeOrders) Place(ctx context.Context, input order.PlaceInput) (order.Placement, error) {
	f.called, f.ctx, f.placeInput = true, ctx, input
	return order.Placement{OrderID: input.OrderID, Status: "AWAITING_PAYMENT", ThreeDS: &order.ThreeDSChallenge{ChallengeID: "tds_1"}}, f.err
}

func (f *fakeOrders) ConfirmThreeDS(ctx context.Context, input order.ConfirmInput) (order.Placement, error) {
	f.called, f.ctx, f.confirmInput = true, ctx, input
	return order.Placement{OrderID: input.OrderID, Status: "PAID"}, f.err
}

func (f *fakeOrders) Get(ctx context.Context, userID, orderID string) (order.Order, error) {
	f.called, f.ctx, f.getUserID, f.getOrderID = true, ctx, userID, orderID
	return order.Order{ID: orderID, Status: "PAID", Lines: []order.Line{}, Timeline: []order.TimelineEntry{}}, f.err
}

func orderApp(orders *fakeOrders, allowDemoUser bool) *fiber.App {
	return New(Deps{
		Health:           fakeReporter{report: healthyReport()},
		CartReserver:     orders,
		OrderPlacer:      orders,
		ThreeDSConfirmer: orders,
		OrderGetter:      orders,
		AllowDemoUser:    allowDemoUser,
		Logger:           silentLogger(),
	})
}

const validReserveBody = `{"marketId":"mkt_migros-jet-moda","items":[{"productId":"prd_cikolata-80","quantity":2}],` +
	`"address":{"line":"Kadikoy","location":{"lat":40.99,"lng":29.02}},` +
	`"expectedTotal":{"amountMinor":19360,"currency":"TRY"},"couponCode":"ILK10"}`

const validPlaceBody = `{"orderId":"` + testOrderID + `","payment":{"method":"CARD","cardToken":"tok_test_4242"}}`

// orderRequest, gecerli kimlik ve anahtarla bir istek kurar; headers ile
// degistirilir (bos deger basligi SILER).
func orderRequest(method, path, body string, headers map[string]string) *http.Request {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	request.Header.Set(UserIDHeader, "usr_1")
	request.Header.Set(IdempotencyKeyHeader, "anahtar-0001")
	for name, value := range headers {
		if value == "" {
			request.Header.Del(name)
			continue
		}
		request.Header.Set(name, value)
	}
	return request
}

func send(t *testing.T, app *fiber.App, request *http.Request) (int, Envelope) {
	t.Helper()
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	return response.StatusCode, decode(t, response)
}

// detailsOf, hata zarfinin ayrintisini nesne olarak okur.
func detailsOf(t *testing.T, envelope Envelope) map[string]any {
	t.Helper()
	if envelope.Error == nil {
		t.Fatalf("hata zarfi bekleniyordu: %+v", envelope)
	}
	details, isMap := envelope.Error.Details.(map[string]any)
	if !isMap {
		t.Fatalf("details nesne olmali: %+v", envelope.Error.Details)
	}
	return details
}

func TestReserveCartPassesInputAndReturns201(t *testing.T) {
	orders := &fakeOrders{}
	app := orderApp(orders, true)

	status, envelope := send(t, app, orderRequest(http.MethodPost, "/v1/cart/reserve", validReserveBody,
		map[string]string{RequestIDHeader: "req_rezervasyon"}))

	if status != http.StatusCreated || !envelope.Success {
		t.Fatalf("201 + success bekleniyordu: %d %+v", status, envelope)
	}
	input := orders.reserveInput
	if input.UserID != "usr_1" || input.IdempotencyKey != "anahtar-0001" || input.MarketID != "mkt_migros-jet-moda" {
		t.Errorf("kimlik, anahtar ve market tasinmali: %+v", input)
	}
	if len(input.Items) != 1 || input.Items[0] != (order.CartItem{ProductID: "prd_cikolata-80", Quantity: 2}) {
		t.Errorf("kalemler tasinmali: %+v", input.Items)
	}
	if input.Location == nil || input.Location.Lat != 40.99 || input.ExpectedTotal == nil || input.ExpectedTotal.AmountMinor != 19_360 {
		t.Errorf("konum ve beklenen toplam tasinmali: %+v", input)
	}
	if input.AddressLine != "Kadikoy" || input.CouponCode != "ILK10" {
		t.Errorf("adres ve kupon tasinmali: %+v", input)
	}
	outgoing, found := metadata.FromOutgoingContext(orders.ctx)
	if !found {
		t.Fatal("servise giden baglamda metadata yok")
	}
	if got := outgoing.Get(requestIDMetadataKey); len(got) != 1 || got[0] != "req_rezervasyon" {
		t.Errorf("x-request-id servise tasinmali: %v", got)
	}
}

func TestOrderEndpointsRequireUser(t *testing.T) {
	cases := []struct {
		method, path, body string
	}{
		{http.MethodPost, "/v1/cart/reserve", validReserveBody},
		{http.MethodPost, "/v1/orders", validPlaceBody},
		{http.MethodPost, "/v1/orders/" + testOrderID + "/3ds", `{"challengeId":"tds_1","otp":"123456"}`},
		{http.MethodGet, "/v1/orders/" + testOrderID, ""},
	}
	for _, tc := range cases {
		orders := &fakeOrders{}
		app := orderApp(orders, true)

		status, envelope := send(t, app, orderRequest(tc.method, tc.path, tc.body, map[string]string{UserIDHeader: ""}))

		if status != http.StatusUnauthorized || envelope.Error == nil || envelope.Error.Code != apperror.CodeUnauthorized {
			t.Errorf("%s %s: 401 UNAUTHORIZED bekleniyordu: %d %+v", tc.method, tc.path, status, envelope)
		}
		if orders.called {
			t.Errorf("%s %s: kimliksiz istekte servis cagrilmamaliydi", tc.method, tc.path)
		}
	}
}

func TestInvalidDemoUserIsRejected(t *testing.T) {
	orders := &fakeOrders{}
	app := orderApp(orders, true)

	status, envelope := send(t, app, orderRequest(http.MethodGet, "/v1/orders/"+testOrderID, "", map[string]string{UserIDHeader: "admin; drop"}))

	if status != http.StatusUnauthorized || detailsOf(t, envelope)[UserIDHeader] != userIDReason {
		t.Errorf("bicimsiz kimlik 401 ve alan adiyla donmeli: %d %+v", status, envelope)
	}
}

func TestProductionIgnoresDemoUserHeader(t *testing.T) {
	// JWT (T8.1) gelene kadar production'da korumali uc HIC acilmaz: baslik
	// kabul edilseydi herkes kendini baska biri gibi tanitabilirdi.
	orders := &fakeOrders{}
	app := orderApp(orders, false)

	status, envelope := send(t, app, orderRequest(http.MethodPost, "/v1/cart/reserve", validReserveBody, nil))

	if status != http.StatusUnauthorized || envelope.Error.Details != nil {
		t.Errorf("401 ve ayrintisiz cevap bekleniyordu: %d %+v", status, envelope)
	}
	if orders.called {
		t.Error("production'da servis cagrilmamaliydi")
	}
}

func TestMutationsRequireIdempotencyKey(t *testing.T) {
	cases := []struct{ path, body string }{
		{"/v1/cart/reserve", validReserveBody},
		{"/v1/orders", validPlaceBody},
		{"/v1/orders/" + testOrderID + "/3ds", `{"challengeId":"tds_1","otp":"123456"}`},
	}
	for _, tc := range cases {
		orders := &fakeOrders{}
		app := orderApp(orders, true)

		status, envelope := send(t, app, orderRequest(http.MethodPost, tc.path, tc.body, map[string]string{IdempotencyKeyHeader: ""}))

		if status != http.StatusBadRequest || detailsOf(t, envelope)[IdempotencyKeyHeader] != requiredReason {
			t.Errorf("%s: 400 + Idempotency-Key zorunlu bekleniyordu: %d %+v", tc.path, status, envelope)
		}
		if orders.called {
			t.Errorf("%s: anahtarsiz istekte servis cagrilmamaliydi", tc.path)
		}
	}
}

func TestReserveRejectsBodyFormatErrors(t *testing.T) {
	cases := []struct {
		name    string
		body    string
		headers map[string]string
		field   string
		reason  string
	}{
		{
			name:   "bilinmeyen alan (adres etiketi sozlesmede yok)",
			body:   strings.Replace(validReserveBody, `"line":"Kadikoy"`, `"title":"Ev","line":"Kadikoy"`, 1),
			field:  "title",
			reason: unknownFieldReason,
		},
		{name: "bozuk JSON", body: `{bozuk`, field: bodyField, reason: invalidJSONReason},
		{name: "bos govde", body: ``, field: bodyField, reason: requiredReason},
		{name: "iki JSON degeri", body: validReserveBody + `{}`, field: bodyField, reason: singleValueReason},
		{
			name:    "JSON olmayan icerik",
			body:    validReserveBody,
			headers: map[string]string{fiber.HeaderContentType: "text/plain"},
			field:   contentTypeField,
			reason:  jsonContentReason,
		},
		{
			name:   "konumda boylam yok (0 degil, YOK)",
			body:   strings.Replace(validReserveBody, `"location":{"lat":40.99,"lng":29.02}`, `"location":{"lat":40.99}`, 1),
			field:  "address.location.lng",
			reason: requiredReason,
		},
		{
			name:   "tutarda kurus yok",
			body:   strings.Replace(validReserveBody, `"amountMinor":19360,`, ``, 1),
			field:  "expectedTotal.amountMinor",
			reason: requiredReason,
		},
	}
	for _, tc := range cases {
		orders := &fakeOrders{}
		app := orderApp(orders, true)

		status, envelope := send(t, app, orderRequest(http.MethodPost, "/v1/cart/reserve", tc.body, tc.headers))

		if status != http.StatusBadRequest || envelope.Error.Code != apperror.CodeValidationFailed {
			t.Errorf("%s: 400 VALIDATION_FAILED bekleniyordu: %d %+v", tc.name, status, envelope)
			continue
		}
		if got := detailsOf(t, envelope)[tc.field]; got != tc.reason {
			t.Errorf("%s: details[%s] = %v, %q bekleniyordu (%+v)", tc.name, tc.field, got, tc.reason, envelope.Error.Details)
		}
		if orders.called {
			t.Errorf("%s: bicimsiz govdede servis cagrilmamaliydi", tc.name)
		}
	}
}

func TestReserveReportsWrongTypeWithFieldName(t *testing.T) {
	orders := &fakeOrders{}
	app := orderApp(orders, true)
	body := strings.Replace(validReserveBody, `"quantity":2`, `"quantity":"iki"`, 1)

	status, envelope := send(t, app, orderRequest(http.MethodPost, "/v1/cart/reserve", body, nil))

	details := detailsOf(t, envelope)
	found := false
	for field, reason := range details {
		if strings.Contains(field, "quantity") && reason == integerReason {
			found = true
		}
	}
	if status != http.StatusBadRequest || !found {
		t.Errorf("adet alani 'tam sayi olmali' ile donmeli: %d %+v", status, details)
	}
}

func TestOversizedBodyIsRejected(t *testing.T) {
	// app.Test sinir ustu govdeyi sunucuya ulastirmadan kendisi reddeder; asil
	// davranis (Fiber'in sunucu hata yolu -> bizim zarfimiz) GERCEK dinleyicide gorulur.
	orders := &fakeOrders{}
	app := orderApp(orders, true)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("dinleyici acilamadi: %v", err)
	}
	served := make(chan error, 1)
	go func() { served <- app.Listener(listener, fiber.ListenConfig{DisableStartupMessage: true}) }()
	t.Cleanup(func() {
		if shutdownErr := app.Shutdown(); shutdownErr != nil {
			t.Errorf("sunucu kapanmadi: %v", shutdownErr)
		}
		if serveErr := <-served; serveErr != nil {
			t.Errorf("sunucu hatayla durdu: %v", serveErr)
		}
	})

	body := `{"marketId":"` + strings.Repeat("a", maxBodyBytes) + `"}`
	request, err := http.NewRequestWithContext(context.Background(), http.MethodPost,
		"http://"+listener.Addr().String()+"/v1/cart/reserve", strings.NewReader(body))
	if err != nil {
		t.Fatalf("istek kurulamadi: %v", err)
	}
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	request.Header.Set(UserIDHeader, "usr_1")
	request.Header.Set(IdempotencyKeyHeader, "anahtar-0001")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	status, envelope := response.StatusCode, decode(t, response)

	if status != http.StatusBadRequest || envelope.Error == nil || envelope.Error.Code != apperror.CodeValidationFailed {
		t.Errorf("sinir ustu govde 400 VALIDATION_FAILED donmeli: %d %+v", status, envelope)
	}
	if orders.called {
		t.Error("sinir ustu govde servise gitmemeliydi")
	}
}

func TestPlaceOrderSendsCardAndConnectionIP(t *testing.T) {
	orders := &fakeOrders{}
	app := orderApp(orders, true)

	status, envelope := send(t, app, orderRequest(http.MethodPost, "/v1/orders", validPlaceBody,
		// Istemcinin yazdigi IP basligi YOK SAYILMALI (B9): IP baglantidan gelir.
		map[string]string{"X-Forwarded-For": "1.2.3.4"}))

	if status != http.StatusCreated {
		t.Fatalf("201 bekleniyordu: %d %+v", status, envelope)
	}
	input := orders.placeInput
	if input.OrderID != testOrderID || input.CardToken != "tok_test_4242" || input.UserID != "usr_1" || input.IdempotencyKey != "anahtar-0001" {
		t.Errorf("siparis, jeton, kimlik ve anahtar tasinmali: %+v", input)
	}
	if input.ClientIP == "" || input.ClientIP == "1.2.3.4" {
		t.Errorf("IP baglantidan gelmeli, basliktan degil: %q", input.ClientIP)
	}
	data, isMap := envelope.Data.(map[string]any)
	if !isMap || data["threeDs"] == nil {
		t.Errorf("3DS bekleyen cevap threeDs tasimali: %+v", envelope.Data)
	}
}

func TestPlaceOrderPaymentFormat(t *testing.T) {
	cases := []struct {
		name, body, field, reason string
	}{
		{"odeme yok", `{"orderId":"` + testOrderID + `"}`, "payment", requiredReason},
		{"kart disi yontem", `{"orderId":"` + testOrderID + `","payment":{"method":"CASH_ON_DELIVERY"}}`, "payment.method", "CARD olmali"},
	}
	for _, tc := range cases {
		orders := &fakeOrders{}
		app := orderApp(orders, true)

		status, envelope := send(t, app, orderRequest(http.MethodPost, "/v1/orders", tc.body, nil))

		if status != http.StatusBadRequest || detailsOf(t, envelope)[tc.field] != tc.reason {
			t.Errorf("%s: 400 + %s bekleniyordu: %d %+v", tc.name, tc.field, status, envelope)
		}
		if orders.called {
			t.Errorf("%s: servis cagrilmamaliydi", tc.name)
		}
	}
}

func TestConfirmThreeDSUsesPathID(t *testing.T) {
	orders := &fakeOrders{}
	app := orderApp(orders, true)

	status, envelope := send(t, app, orderRequest(http.MethodPost, "/v1/orders/"+testOrderID+"/3ds", `{"challengeId":"tds_1","otp":"123456"}`, nil))

	if status != http.StatusOK || !envelope.Success {
		t.Fatalf("200 bekleniyordu: %d %+v", status, envelope)
	}
	if got := orders.confirmInput; got.OrderID != testOrderID || got.ChallengeID != "tds_1" || got.Code != "123456" || got.UserID != "usr_1" {
		t.Errorf("yol kimligi, jeton, kod ve kullanici tasinmali: %+v", got)
	}
}

func TestGetOrderUsesPathIDAndUser(t *testing.T) {
	orders := &fakeOrders{}
	app := orderApp(orders, true)

	status, envelope := send(t, app, orderRequest(http.MethodGet, "/v1/orders/"+testOrderID, "", nil))

	if status != http.StatusOK || !envelope.Success {
		t.Fatalf("200 bekleniyordu: %d %+v", status, envelope)
	}
	if orders.getUserID != "usr_1" || orders.getOrderID != testOrderID {
		t.Errorf("sahiplik icin kullanici ve yol kimligi tasinmali: %q %q", orders.getUserID, orders.getOrderID)
	}
}

func TestServiceErrorKeepsNumericDetails(t *testing.T) {
	// B13: "409 PRICE_CHANGED + guncel toplam" - toplam SAYI olarak gitmeli.
	orders := &fakeOrders{err: &apperror.Error{
		Code:    apperror.CodePriceChanged,
		Details: map[string]any{"totalMinor": json.RawMessage(`19360`), "currency": "TRY"},
	}}
	app := orderApp(orders, true)

	status, envelope := send(t, app, orderRequest(http.MethodPost, "/v1/cart/reserve", validReserveBody, nil))

	if status != http.StatusConflict || envelope.Error.Code != apperror.CodePriceChanged {
		t.Fatalf("409 PRICE_CHANGED bekleniyordu: %d %+v", status, envelope)
	}
	if details := detailsOf(t, envelope); details["totalMinor"] != float64(19360) || details["currency"] != "TRY" {
		t.Errorf("guncel toplam sayi olarak gelmeli: %+v", details)
	}
}
