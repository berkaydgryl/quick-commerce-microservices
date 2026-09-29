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
	// calls, adaptorun kac kez cagrildigi (tekrar korumasi: ayni anahtar tek cagri).
	calls int
	err   error
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

func (f *fakeOrders) Get(ctx context.Context, userID, orderID string) (order.Order, error) {
	f.called, f.ctx, f.getUserID, f.getOrderID = true, ctx, userID, orderID
	return order.Order{ID: orderID, Status: "PAID", Lines: []order.Line{}, Timeline: []order.TimelineEntry{}}, f.err
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
		Health:           fakeReporter{report: healthyReport()},
		CartReserver:     orders,
		OrderPlacer:      orders,
		ThreeDSConfirmer: orders,
		OrderGetter:      orders,
		CheckoutSignals:  signals,
		AccessTokens:     testTokens(),
		Idempotency:      testIdempotency(),
		Logger:           silentLogger(),
	})
}

const validReserveBody = `{"marketId":"mkt_migros-jet-moda","items":[{"productId":"prd_cikolata-80","quantity":2}],` +
	`"address":{"line":"Kadikoy","location":{"lat":40.99,"lng":29.02}},` +
	`"expectedTotal":{"amountMinor":19360,"currency":"TRY"},"couponCode":"ILK10"}`

const validPlaceBody = `{"orderId":"` + testOrderID + `","payment":{"method":"CARD","cardToken":"tok_test_4242"}}`

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
