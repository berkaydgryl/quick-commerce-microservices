package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"google.golang.org/grpc/metadata"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/orderhistory"
)

const testOrderID = "ord_db77f4c0e24f49919cc1d78a649c9c94"

// fakeOrders, dort siparis ucunun adaptorunun yerine gecer; aldigi girdiyi ve
// baglami saklar ki kimlik, anahtar ve korelasyon kimliginin tasindigi gorulsun.
type fakeOrders struct {
	reserveInput order.ReserveInput
	placeInput   order.PlaceInput
	confirmInput order.ConfirmInput
	releaseInput order.ReleaseInput
	getUserID    string
	getOrderID   string
	listUserID   string
	listSize     int32
	listToken    string
	ctx          context.Context
	called       bool
	// calls, adaptorun kac kez cagrildigi (tekrar korumasi: ayni anahtar tek cagri).
	calls int
	err   error
	// details, GetDetailed'in dondurdugu ayrinti (T12.4); nil = ayrintisiz.
	details *order.DetailsView
}

func (f *fakeOrders) Reserve(ctx context.Context, input order.ReserveInput) (order.Reservation, error) {
	f.called, f.ctx, f.reserveInput, f.calls = true, ctx, input, f.calls+1
	return order.Reservation{OrderID: testOrderID, Status: "DRAFT"}, f.err
}

func (f *fakeOrders) Place(ctx context.Context, input order.PlaceInput) (order.Placement, error) {
	f.called, f.ctx, f.placeInput, f.calls = true, ctx, input, f.calls+1
	return order.Placement{OrderID: input.OrderID, Status: "AWAITING_PAYMENT", ThreeDS: &order.ThreeDSChallenge{ChallengeID: "tds_1"}}, f.err
}

func (f *fakeOrders) ConfirmThreeDS(ctx context.Context, input order.ConfirmInput) (order.Placement, error) {
	f.called, f.ctx, f.confirmInput, f.calls = true, ctx, input, f.calls+1
	return order.Placement{OrderID: input.OrderID, Status: "PAID"}, f.err
}

func (f *fakeOrders) Release(ctx context.Context, input order.ReleaseInput) (order.ReservationRelease, error) {
	f.called, f.ctx, f.releaseInput, f.calls = true, ctx, input, f.calls+1
	return order.ReservationRelease{OrderID: input.OrderID, Released: true, ReleasedAt: "2026-10-02T12:00:00Z"}, f.err
}

func (f *fakeOrders) Get(ctx context.Context, userID, orderID string) (order.Order, error) {
	f.called, f.ctx, f.getUserID, f.getOrderID = true, ctx, userID, orderID
	return order.Order{ID: orderID, Status: "PAID", Lines: []order.Line{}, Timeline: []order.TimelineEntry{}}, f.err
}

func (f *fakeOrders) GetDetailed(ctx context.Context, userID, orderID string) (order.OrderDetail, error) {
	found, err := f.Get(ctx, userID, orderID)
	return order.OrderDetail{Order: found, Details: f.details}, err
}

func (f *fakeOrders) List(ctx context.Context, userID string, pageSize int32, pageToken string) (orderhistory.List, error) {
	f.called, f.ctx, f.listUserID, f.listSize, f.listToken = true, ctx, userID, pageSize, pageToken
	return orderhistory.List{Items: []orderhistory.Summary{{ID: testOrderID, Status: "DELIVERED", MarketID: "mkt_a101-caferaga"}}}, f.err
}

// fakeSignals, siparis sinyallerini oturum yerine sabit degerlerden verir;
// hangi kimlik ve IP ile cagrildigini saklar.
type fakeSignals struct {
	identity auth.Identity
	ip       string
	called   bool
	err      error
}

// testSessionLocation, sahte oturumun konumu (Ankara).
var testSessionLocation = auth.GeoPoint{Lat: 39.93, Lng: 32.86}

func (f *fakeSignals) CheckoutSignals(_ context.Context, identity auth.Identity, ip string) (auth.CheckoutSignals, error) {
	f.called, f.identity, f.ip = true, identity, ip
	location := testSessionLocation
	return auth.CheckoutSignals{
		IPAddress: ip, IPCity: "Ankara", DeviceID: "dvc_test", AccountsOnDevice: 2,
		PreviousIPAddress: "10.0.0.9", SessionLocation: &location,
		AccountCreatedAt: time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC),
	}, f.err
}

func orderApp(orders *fakeOrders) *fiber.App {
	return orderAppWithSignals(orders, &fakeSignals{})
}

func orderAppWithSignals(orders *fakeOrders, signals *fakeSignals) *fiber.App {
	return New(Deps{
		Health:              fakeReporter{report: healthyReport()},
		CartReserver:        orders,
		ReservationReleaser: orders,
		OrderPlacer:         orders,
		ThreeDSConfirmer:    orders,
		OrderGetter:         orders,
		OrderLister:         orders,
		CheckoutSignals:     signals,
		AccessTokens:        testTokens(),
		Idempotency:         testIdempotency(),
		Logger:              silentLogger(),
	})
}

const validReserveBody = `{"marketId":"mkt_migros-jet-moda","items":[{"productId":"prd_cikolata-80","quantity":2}],` +
	`"address":{"line":"Kadikoy","location":{"lat":40.99,"lng":29.02}},` +
	`"expectedTotal":{"amountMinor":19360,"currency":"TRY"},"couponCode":"ILK10"}`

// validPlaceBody: ayrinti T12.4'ten beri zorunlu (hediyesiz, notsuz, onayli).
const validPlaceBody = `{"orderId":"` + testOrderID + `","payment":{"method":"CARD","cardToken":"tok_test_4242"},` +
	`"details":{"note":"","doNotRingBell":false,"agreementsAccepted":true}}`

// orderRequest, gecerli kimlik ve anahtarla bir istek kurar; headers ile
// degistirilir (bos deger basligi SILER).
func orderRequest(t *testing.T, method, path, body string, headers map[string]string) *http.Request {
	t.Helper()
	request := newRequest(t, method, path, strings.NewReader(body))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	request.Header.Set(fiber.HeaderAuthorization, bearer(t))
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
	app := orderApp(orders)

	status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", validReserveBody,
		map[string]string{RequestIDHeader: testRequestID}))

	if status != http.StatusCreated || !envelope.Success {
		t.Fatalf("201 + success bekleniyordu: %d %+v", status, envelope)
	}
	input := orders.reserveInput
	if input.UserID != testUserID || input.IdempotencyKey != "anahtar-0001" || input.MarketID != "mkt_migros-jet-moda" {
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
	if got := outgoing.Get(requestIDMetadataKey); len(got) != 1 || got[0] != testRequestID {
		t.Errorf("x-request-id servise tasinmali: %v", got)
	}
}

func TestPlaceOrderSendsCardAndSessionSignals(t *testing.T) {
	orders, signals := &fakeOrders{}, &fakeSignals{}
	app := orderAppWithSignals(orders, signals)

	status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/orders", validPlaceBody,
		// Istemcinin yazdigi IP basligi YOK SAYILMALI (B9): IP baglantidan gelir.
		map[string]string{"X-Forwarded-For": "1.2.3.4"}))

	if status != http.StatusCreated {
		t.Fatalf("201 bekleniyordu: %d %+v", status, envelope)
	}
	input := orders.placeInput
	if input.OrderID != testOrderID || input.CardToken != "tok_test_4242" || input.UserID != testUserID || input.IdempotencyKey != "anahtar-0001" {
		t.Errorf("siparis, jeton, kimlik ve anahtar tasinmali: %+v", input)
	}
	// Sinyaller jetondaki OTURUMDAN okunur (T8.1); IP baglantidan.
	if signals.identity != (auth.Identity{UserID: testUserID, SessionID: testSessionID}) {
		t.Errorf("sinyal okuyucu jetondaki kullanici ve oturumla cagrilmali: %+v", signals.identity)
	}
	if signals.ip == "" || signals.ip == "1.2.3.4" || input.Signals.IPAddress != signals.ip {
		t.Errorf("IP baglantidan gelmeli, basliktan degil: %q", signals.ip)
	}
	got := input.Signals
	if got.DeviceID != "dvc_test" || got.AccountsOnDevice != 2 || got.PreviousIPAddress != "10.0.0.9" || got.IPCity != "Ankara" ||
		got.SessionLocation == nil || got.SessionLocation.Lat != testSessionLocation.Lat || got.AccountCreatedAt.IsZero() {
		t.Errorf("oturum sinyallerinin hepsi siparise tasinmali: %+v", got)
	}
	data, isMap := envelope.Data.(map[string]any)
	if !isMap || data["threeDs"] == nil {
		t.Errorf("3DS bekleyen cevap threeDs tasimali: %+v", envelope.Data)
	}
}

func TestConfirmThreeDSUsesPathID(t *testing.T) {
	orders := &fakeOrders{}
	app := orderApp(orders)

	status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/orders/"+testOrderID+"/3ds", `{"challengeId":"tds_1","otp":"123456"}`, nil))

	if status != http.StatusOK || !envelope.Success {
		t.Fatalf("200 bekleniyordu: %d %+v", status, envelope)
	}
	if got := orders.confirmInput; got.OrderID != testOrderID || got.ChallengeID != "tds_1" || got.Code != "123456" || got.UserID != testUserID {
		t.Errorf("yol kimligi, jeton, kod ve kullanici tasinmali: %+v", got)
	}
}

func TestGetOrderUsesPathIDAndUser(t *testing.T) {
	orders := &fakeOrders{}
	app := orderApp(orders)

	status, envelope := send(t, app, orderRequest(t, http.MethodGet, "/v1/orders/"+testOrderID, "", nil))

	if status != http.StatusOK || !envelope.Success {
		t.Fatalf("200 bekleniyordu: %d %+v", status, envelope)
	}
	if orders.getUserID != testUserID || orders.getOrderID != testOrderID {
		t.Errorf("sahiplik icin kullanici ve yol kimligi tasinmali: %q %q", orders.getUserID, orders.getOrderID)
	}
}

func TestServiceErrorKeepsNumericDetails(t *testing.T) {
	// B13: "409 PRICE_CHANGED + guncel toplam" - toplam SAYI olarak gitmeli.
	orders := &fakeOrders{err: &apperror.Error{
		Code:    apperror.CodePriceChanged,
		Details: map[string]any{"totalMinor": json.RawMessage(`19360`), "currency": "TRY"},
	}}
	app := orderApp(orders)

	status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", validReserveBody, nil))

	if status != http.StatusConflict || envelope.Error.Code != apperror.CodePriceChanged {
		t.Fatalf("409 PRICE_CHANGED bekleniyordu: %d %+v", status, envelope)
	}
	if details := detailsOf(t, envelope); details["totalMinor"] != float64(19360) || details["currency"] != "TRY" {
		t.Errorf("guncel toplam sayi olarak gelmeli: %+v", details)
	}
}

func TestPlaceOrderWithEndedSessionIsUnauthorized(t *testing.T) {
	// Cikis yapilmis oturum: erisim jetonu suresi dolmamis olsa da siparis
	// verilemez (sinyal okuyucu 401 doner); siparis servisine gidilmez.
	orders := &fakeOrders{}
	signals := &fakeSignals{err: apperror.New(apperror.CodeUnauthorized, map[string]string{"Authorization": "oturum kapatilmis"})}
	app := orderAppWithSignals(orders, signals)

	status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/orders", validPlaceBody, nil))

	if status != http.StatusUnauthorized || envelope.Error.Code != apperror.CodeUnauthorized {
		t.Errorf("401 bekleniyordu: %d %+v", status, envelope)
	}
	if orders.called {
		t.Error("oturumu biten istekte siparis servisi cagrilmamaliydi")
	}
}

func TestMalformedOrderDoesNotReadSignals(t *testing.T) {
	// Bicim hatasi veritabanina gitmeden doner: sinyaller dogrulamadan SONRA okunur.
	orders, signals := &fakeOrders{}, &fakeSignals{}
	app := orderAppWithSignals(orders, signals)

	status, _ := send(t, app, orderRequest(t, http.MethodPost, "/v1/orders", `{"orderId":"`+testOrderID+`"}`, nil))

	if status != http.StatusBadRequest || signals.called || orders.called {
		t.Errorf("400 ve sinyal okunmamasi bekleniyordu: %d, sinyal %v, siparis %v", status, signals.called, orders.called)
	}
}

func TestReleaseReservationUsesPathIDUserAndKey(t *testing.T) {
	orders := &fakeOrders{}
	app := orderApp(orders)

	status, envelope := send(t, app, orderRequest(t, http.MethodDelete, "/v1/cart/reserve/"+testOrderID, "",
		map[string]string{RequestIDHeader: testRequestID}))

	if status != http.StatusOK || !envelope.Success {
		t.Fatalf("200 + success bekleniyordu: %d %+v", status, envelope)
	}
	want := order.ReleaseInput{UserID: testUserID, OrderID: testOrderID, IdempotencyKey: "anahtar-0001"}
	if orders.releaseInput != want {
		t.Errorf("kimlik, yol kimligi ve anahtar tasinmali: %+v", orders.releaseInput)
	}
	if data, isMap := envelope.Data.(map[string]any); !isMap || data["released"] != true || data["orderId"] != testOrderID {
		t.Errorf("cevap birakma sonucunu tasimali: %+v", envelope.Data)
	}
}

func TestReleaseReservationRequiresIdempotencyKey(t *testing.T) {
	orders := &fakeOrders{}
	app := orderApp(orders)

	status, envelope := send(t, app, orderRequest(t, http.MethodDelete, "/v1/cart/reserve/"+testOrderID, "",
		map[string]string{IdempotencyKeyHeader: ""}))

	if status != http.StatusBadRequest || envelope.Error.Code != apperror.CodeValidationFailed {
		t.Fatalf("400 VALIDATION_FAILED bekleniyordu: %d %+v", status, envelope)
	}
	if orders.called {
		t.Error("anahtarsiz istekte adaptor cagrilmamali")
	}
}

func TestReleaseReservationReplaysSameKeyWithoutSecondCall(t *testing.T) {
	orders := &fakeOrders{}
	app := orderApp(orders)
	request := func() *http.Request {
		return orderRequest(t, http.MethodDelete, "/v1/cart/reserve/"+testOrderID, "", nil)
	}

	first, _ := send(t, app, request())
	second, envelope := send(t, app, request())

	if first != http.StatusOK || second != http.StatusOK || !envelope.Success {
		t.Fatalf("ikisi de 200 olmali: %d %d %+v", first, second, envelope)
	}
	if orders.calls != 1 {
		t.Errorf("ayni anahtarla ikinci istek adaptore gitmemeli: %d cagri", orders.calls)
	}
}

func TestReleaseReservationPassesServiceErrors(t *testing.T) {
	orders := &fakeOrders{err: &apperror.Error{
		Code:    apperror.CodeRequestInProgress,
		Details: map[string]any{"orderId": testOrderID, "paymentStatus": "SUCCEEDED"},
	}}
	app := orderApp(orders)

	status, envelope := send(t, app, orderRequest(t, http.MethodDelete, "/v1/cart/reserve/"+testOrderID, "", nil))

	if status != http.StatusConflict || envelope.Error.Code != apperror.CodeRequestInProgress {
		t.Fatalf("409 REQUEST_IN_PROGRESS bekleniyordu: %d %+v", status, envelope)
	}
}

func TestListOrdersPassesUserCursorAndSizeAndIsPrivate(t *testing.T) {
	orders := &fakeOrders{}
	app := orderApp(orders)

	status, header, envelope := exchange(t, app, orderRequest(t, http.MethodGet, "/v1/orders?pageSize=5&pageToken=imlec", "", nil))

	if status != http.StatusOK || orders.listUserID != testUserID || orders.listSize != 5 || orders.listToken != "imlec" {
		t.Fatalf("200, jetondaki kullanici, boy ve imlec bekleniyordu: %d %+v %+v", status, orders, envelope)
	}
	if header.Get(fiber.HeaderCacheControl) != noStore {
		t.Errorf("gecmis siparisler kisisel veridir, onbelleklenmemeli: %q", header.Get(fiber.HeaderCacheControl))
	}
	if list := dataOf[orderhistory.List](t, envelope); len(list.Items) != 1 || list.Items[0].ID != testOrderID {
		t.Errorf("zarfin data alani gecmis listesi olmali: %+v", list)
	}
}

func TestListOrdersRejectsBadSizeAndUnknownQuery(t *testing.T) {
	orders := &fakeOrders{}
	app := orderApp(orders)

	status, envelope := send(t, app, orderRequest(t, http.MethodGet, "/v1/orders?pageSize=iki", "", nil))
	if status != http.StatusBadRequest || detailsOf(t, envelope)["pageSize"] == nil {
		t.Errorf("tam sayi olmayan boy 400 pageSize: %d %+v", status, envelope)
	}
	status, envelope = send(t, app, orderRequest(t, http.MethodGet, "/v1/orders?status=DELIVERED", "", nil))
	if status != http.StatusBadRequest || detailsOf(t, envelope)["status"] != unknownQueryReason {
		t.Errorf("bilinmeyen sorgu 400: %d %+v", status, envelope)
	}
	if orders.called {
		t.Error("gecersiz istekte adaptor cagrilmamali")
	}
}

func TestGetOrderIsPrivate(t *testing.T) {
	// T11.16, L8: tek siparis de kisisel veridir (adres, urunler).
	app := orderApp(&fakeOrders{})

	status, header, _ := exchange(t, app, orderRequest(t, http.MethodGet, "/v1/orders/"+testOrderID, "", nil))

	if status != http.StatusOK || header.Get(fiber.HeaderCacheControl) != noStore {
		t.Errorf("200 ve no-store bekleniyordu: %d %q", status, header.Get(fiber.HeaderCacheControl))
	}
}
