package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
)

// Tekrar korumasi (ADR-08 ve eki, T8.2): ayni anahtarla gelen istek ucu ikinci
// kez calistirmaz. Testler bellek deposuyla kurulur; Redis'teki ayni kurallar
// idempotency paketinin entegrasyon testinde sinanir.

// testClock, ilerletilebilen saat (kaydin omru icin).
type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *testClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// replayApp, siparis uclarini verilen tekrar korumasiyla kurar.
func replayApp(orders *fakeOrders, signals *fakeSignals, settings Idempotency) *fiber.App {
	return New(Deps{
		Health:           fakeReporter{report: healthyReport()},
		CartReserver:     orders,
		OrderPlacer:      orders,
		ThreeDSConfirmer: orders,
		OrderGetter:      orders,
		CheckoutSignals:  signals,
		AccessTokens:     testTokens(),
		Idempotency:      settings,
		Logger:           silentLogger(),
	})
}

// exchangeRaw, istegi gonderir; durum, basliklar ve ham govde doner.
func exchangeRaw(t *testing.T, app *fiber.App, request *http.Request) (int, http.Header, []byte) {
	t.Helper()
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	body, readErr := io.ReadAll(response.Body)
	if closeErr := response.Body.Close(); closeErr != nil {
		t.Errorf("cevap govdesi kapatilamadi: %v", closeErr)
	}
	if readErr != nil {
		t.Fatalf("cevap okunamadi: %v", readErr)
	}
	return response.StatusCode, response.Header, body
}

func envelopeOf(t *testing.T, body []byte) Envelope {
	t.Helper()
	var envelope Envelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatalf("zarf cozulemedi: %v (%s)", err, body)
	}
	return envelope
}

func TestSecondOrderWithSameKeyIsReplayed(t *testing.T) {
	orders := &fakeOrders{}
	app := replayApp(orders, &fakeSignals{}, testIdempotency())

	firstStatus, firstHeader, firstBody := exchangeRaw(t, app, orderRequest(t, http.MethodPost, "/v1/orders", validPlaceBody, nil))
	secondStatus, secondHeader, secondBody := exchangeRaw(t, app, orderRequest(t, http.MethodPost, "/v1/orders", validPlaceBody, nil))

	if firstStatus != http.StatusCreated || secondStatus != http.StatusCreated || string(firstBody) != string(secondBody) {
		t.Fatalf("ikinci istek ilk cevabi aynen almali:\n1: %d %s\n2: %d %s", firstStatus, firstBody, secondStatus, secondBody)
	}
	if firstHeader.Get(IdempotentReplayedHeader) != "" || secondHeader.Get(IdempotentReplayedHeader) != "true" {
		t.Errorf("yalnizca tekrar cevabi isaretlenmeli: %q %q", firstHeader.Get(IdempotentReplayedHeader), secondHeader.Get(IdempotentReplayedHeader))
	}
	if orders.calls != 1 {
		t.Errorf("siparis servisi bir kez cagrilmali, %d kez cagrildi", orders.calls)
	}
}

func TestReserveTwiceWithSameKeyCreatesOneDraft(t *testing.T) {
	// T8.2 kabul olcutu: "Ayni key ile iki istek tek siparis yaratir".
	orders := &fakeOrders{}
	app := replayApp(orders, &fakeSignals{}, testIdempotency())

	var orderIDs []string
	for range 2 {
		status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", validReserveBody, nil))
		if status != http.StatusCreated {
			t.Fatalf("201 bekleniyordu: %d %+v", status, envelope)
		}
		orderIDs = append(orderIDs, dataOf[order.Reservation](t, envelope).OrderID)
	}

	if orders.calls != 1 || orderIDs[0] != orderIDs[1] {
		t.Errorf("tek taslak acilmali: %d cagri, kimlikler %v", orders.calls, orderIDs)
	}
}

func TestSameKeyWithDifferentBodyConflicts(t *testing.T) {
	orders := &fakeOrders{}
	app := replayApp(orders, &fakeSignals{}, testIdempotency())
	send(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", validReserveBody, nil))
	other := strings.Replace(validReserveBody, `"quantity":2`, `"quantity":3`, 1)

	status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", other, nil))

	if status != http.StatusConflict || envelope.Error.Code != apperror.CodeConflict || detailsOf(t, envelope)[IdempotencyKeyHeader] != keyReusedReason {
		t.Errorf("409 CONFLICT ve anahtar ayrintisi bekleniyordu: %d %+v", status, envelope)
	}
	if orders.calls != 1 {
		t.Errorf("farkli govdeyle servis yeniden cagrilmamali: %d", orders.calls)
	}
}

// blockingOrders, rezervasyonu ve siparisi serbest birakilana kadar bekletir.
type blockingOrders struct {
	fakeOrders
	entered chan struct{}
	release chan struct{}
}

func (b *blockingOrders) Reserve(ctx context.Context, input order.ReserveInput) (order.Reservation, error) {
	b.entered <- struct{}{}
	<-b.release
	return b.fakeOrders.Reserve(ctx, input)
}

func (b *blockingOrders) Place(ctx context.Context, input order.PlaceInput) (order.Placement, error) {
	b.entered <- struct{}{}
	<-b.release
	return b.fakeOrders.Place(ctx, input)
}

type rawResult struct {
	status int
	body   []byte
	err    error
}

func TestConcurrentSameKeyGetsRequestInProgress(t *testing.T) {
	// B6: cift tiklama ("ayni anda iki POST /v1/orders: biri siparis, digeri
	// 409"). Ilk istek bitmeden gelen ikinci istek 409 alir; ilki bittikten
	// sonra gelen ucuncusu ilk cevabi alir. Uc bir kez calisir.
	for name, tc := range map[string]struct{ path, body string }{
		"siparis":     {path: "/v1/orders", body: validPlaceBody},
		"rezervasyon": {path: "/v1/cart/reserve", body: validReserveBody},
	} {
		t.Run(name, func(t *testing.T) {
			orders := &blockingOrders{entered: make(chan struct{}, 1), release: make(chan struct{})}
			app := New(Deps{
				Health: fakeReporter{report: healthyReport()}, CartReserver: orders, OrderPlacer: orders, CheckoutSignals: &fakeSignals{},
				AccessTokens: testTokens(), Idempotency: testIdempotency(), Logger: silentLogger(),
			})

			first := make(chan rawResult, 1)
			request := orderRequest(t, http.MethodPost, tc.path, tc.body, nil)
			go func() {
				response, err := app.Test(request, fiber.TestConfig{Timeout: 10 * time.Second})
				if err != nil {
					first <- rawResult{err: err}
					return
				}
				body, readErr := io.ReadAll(response.Body)
				closeErr := response.Body.Close()
				first <- rawResult{status: response.StatusCode, body: body, err: errors.Join(readErr, closeErr)}
			}()
			<-orders.entered

			status, envelope := send(t, app, orderRequest(t, http.MethodPost, tc.path, tc.body, nil))
			if status != http.StatusConflict || envelope.Error.Code != apperror.CodeRequestInProgress ||
				detailsOf(t, envelope)[IdempotencyKeyHeader] != keyInProgressReason {
				t.Errorf("isleniyorken 409 REQUEST_IN_PROGRESS bekleniyordu: %d %+v", status, envelope)
			}

			close(orders.release)
			done := <-first
			if done.err != nil || done.status != http.StatusCreated {
				t.Fatalf("ilk istek 201 ile bitmeli: %d %v %s", done.status, done.err, done.body)
			}
			_, header, again := exchangeRaw(t, app, orderRequest(t, http.MethodPost, tc.path, tc.body, nil))
			if string(again) != string(done.body) || header.Get(IdempotentReplayedHeader) != "true" || orders.calls != 1 {
				t.Errorf("bittikten sonra ilk cevap tekrar edilmeli: %s / %s (%d cagri)", again, done.body, orders.calls)
			}
		})
	}
}

func TestValidationErrorIsNotStored(t *testing.T) {
	// Dogrulama hatasi ucun yan etkisi olmadan doner; istemci duzeltip AYNI
	// anahtarla yeniden gonderebilmeli (CONFLICT degil).
	orders := &fakeOrders{}
	app := replayApp(orders, &fakeSignals{}, testIdempotency())

	status, _ := send(t, app, orderRequest(t, http.MethodPost, "/v1/orders", `{"orderId":"`+testOrderID+`"}`, nil))
	if status != http.StatusBadRequest {
		t.Fatalf("400 bekleniyordu: %d", status)
	}
	status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/orders", validPlaceBody, nil))

	if status != http.StatusCreated || orders.calls != 1 {
		t.Errorf("duzeltilen istek ayni anahtarla islenmeli: %d %+v (%d cagri)", status, envelope, orders.calls)
	}
}

func TestServerErrorReleasesKey(t *testing.T) {
	orders := &fakeOrders{err: apperror.New(apperror.CodeServiceUnavailable, nil)}
	app := replayApp(orders, &fakeSignals{}, testIdempotency())

	status, _ := send(t, app, orderRequest(t, http.MethodPost, "/v1/orders", validPlaceBody, nil))
	if status != http.StatusServiceUnavailable {
		t.Fatalf("503 bekleniyordu: %d", status)
	}
	orders.err = nil
	status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/orders", validPlaceBody, nil))

	if status != http.StatusCreated || orders.calls != 2 {
		t.Errorf("sunucu hatasindan sonra ayni anahtarla yeniden denenebilmeli: %d %+v (%d cagri)", status, envelope, orders.calls)
	}
}

func TestEndedSessionIsNotStored(t *testing.T) {
	// 401 oturumla ilgilidir; yeniden giriste ayni anahtarla siparis verilebilmeli.
	orders := &fakeOrders{}
	signals := &fakeSignals{err: apperror.New(apperror.CodeUnauthorized, nil)}
	app := replayApp(orders, signals, testIdempotency())

	if status, _ := send(t, app, orderRequest(t, http.MethodPost, "/v1/orders", validPlaceBody, nil)); status != http.StatusUnauthorized {
		t.Fatalf("401 bekleniyordu: %d", status)
	}
	signals.err = nil
	status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/orders", validPlaceBody, nil))

	if status != http.StatusCreated || orders.calls != 1 {
		t.Errorf("yeniden giristen sonra islenmeli: %d %+v", status, envelope)
	}
}

func TestBusinessErrorIsReplayedWithCurrentRequestID(t *testing.T) {
	// Is hatasi (ornek PRICE_CHANGED) ucun sonucudur: tekrar edilir. Ama govdedeki
	// requestId BU istegin kimligidir; baslikla ayni olmali (sozlesme kurali).
	orders := &fakeOrders{err: &apperror.Error{Code: apperror.CodePriceChanged, Details: map[string]any{"totalMinor": 19360}}}
	app := replayApp(orders, &fakeSignals{}, testIdempotency())
	_, firstEnvelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", validReserveBody, nil))

	status, header, body := exchangeRaw(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", validReserveBody, nil))

	envelope := envelopeOf(t, body)
	if status != http.StatusConflict || envelope.Error.Code != apperror.CodePriceChanged || header.Get(IdempotentReplayedHeader) != "true" {
		t.Fatalf("PRICE_CHANGED tekrar edilmeli: %d %s", status, body)
	}
	if detailsOf(t, envelope)["totalMinor"] != float64(19360) {
		t.Errorf("ayrinti oldugu gibi tekrar edilmeli: %+v", envelope.Error.Details)
	}
	if got := envelope.Error.RequestID; got != header.Get(RequestIDHeader) || got == firstEnvelope.Error.RequestID {
		t.Errorf("govdedeki requestId bu istegin olmali: govde %q, baslik %q, ilk %q", got, header.Get(RequestIDHeader), firstEnvelope.Error.RequestID)
	}
	if orders.calls != 1 {
		t.Errorf("servis bir kez cagrilmali: %d", orders.calls)
	}
}

func TestKeysAreScopedPerUser(t *testing.T) {
	// Iki kullanici ayni anahtari secse de biri digerinin cevabini almaz.
	orders := &fakeOrders{}
	app := replayApp(orders, &fakeSignals{}, testIdempotency())
	other, err := testTokens().Issue(auth.Identity{UserID: "usr_ffffffffffffffffffffffffffffffff", SessionID: testSessionID})
	if err != nil {
		t.Fatalf("jeton uretilemedi: %v", err)
	}

	send(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", validReserveBody, nil))
	_, header, _ := exchangeRaw(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", validReserveBody,
		map[string]string{fiber.HeaderAuthorization: bearerScheme + " " + other}))

	if orders.calls != 2 || header.Get(IdempotentReplayedHeader) != "" {
		t.Errorf("ikinci kullanici kendi istegiyle islenmeli: %d cagri, tekrar basligi %q", orders.calls, header.Get(IdempotentReplayedHeader))
	}
}

func TestMalformedKeyIsRejected(t *testing.T) {
	for _, key := range []string{"kisa", "anahtar:{usr_1}", "anahtar bosluklu", strings.Repeat("a", 129)} {
		orders := &fakeOrders{}
		app := replayApp(orders, &fakeSignals{}, testIdempotency())

		status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/orders", validPlaceBody, map[string]string{IdempotencyKeyHeader: key}))

		if status != http.StatusBadRequest || detailsOf(t, envelope)[IdempotencyKeyHeader] != idempotencyKeyFormatReason || orders.calls != 0 {
			t.Errorf("%q reddedilmeli: %d %+v", key, status, envelope)
		}
	}
}

// failingStore, ulasilamayan depo.
type failingStore struct{}

func (failingStore) Claim(context.Context, string, idempotency.Record, time.Duration) (bool, idempotency.Record, error) {
	return false, idempotency.Record{}, idempotency.ErrUnavailable
}

func (failingStore) Complete(context.Context, string, string, idempotency.Record, time.Duration) (bool, error) {
	return false, idempotency.ErrUnavailable
}

func (failingStore) Release(context.Context, string, string) (bool, error) {
	return false, idempotency.ErrUnavailable
}

func TestUnavailableStoreFailsClosed(t *testing.T) {
	// Redis yoksa siparis ALINMAZ: korumasiz devam cift siparis demekti.
	orders := &fakeOrders{}
	settings := testIdempotency()
	settings.Store = failingStore{}
	app := replayApp(orders, &fakeSignals{}, settings)

	status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/orders", validPlaceBody, nil))

	if status != http.StatusServiceUnavailable || envelope.Error.Code != apperror.CodeServiceUnavailable || orders.calls != 0 {
		t.Errorf("503 ve servis cagrilmamasi bekleniyordu: %d %+v (%d cagri)", status, envelope, orders.calls)
	}
}

func TestCheckoutRecordLivesTwoHoursAndOthersADay(t *testing.T) {
	// P5: basarili siparisin kaydi 2 saat, rezervasyonunki IDEMPOTENCY_TTL (24 sa).
	clock := &testClock{now: time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)}
	settings := testIdempotency()
	settings.Store = idempotency.NewMemory(clock.Now)
	orders := &fakeOrders{}
	app := replayApp(orders, &fakeSignals{}, settings)
	placeOnce := func() string {
		_, header, _ := exchangeRaw(t, app, orderRequest(t, http.MethodPost, "/v1/orders", validPlaceBody, nil))
		return header.Get(IdempotentReplayedHeader)
	}
	reserveOnce := func() string {
		_, header, _ := exchangeRaw(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", validReserveBody,
			map[string]string{IdempotencyKeyHeader: "rezervasyon-0001"}))
		return header.Get(IdempotentReplayedHeader)
	}

	placeOnce()
	reserveOnce()
	clock.advance(2*time.Hour - time.Second)
	if placeOnce() != "true" || reserveOnce() != "true" {
		t.Fatal("iki saat dolmadan iki kayit da tekrar edilmeli")
	}
	clock.advance(2 * time.Second)
	if placeOnce() != "" {
		t.Error("iki saat sonra siparis kaydi dusmeli (istek yeniden islenir)")
	}
	if reserveOnce() != "true" {
		t.Error("rezervasyon kaydi 24 saat yasamali")
	}
}

func TestRegisterWithSameKeyIsNotReplayed(t *testing.T) {
	// Kayit cevabi jeton tasir; jeton Redis'e YAZILMAZ (ADR-08 eki). Ayni
	// anahtarla tekrar ucun kendisine gider: telefon kayitli, 409.
	app := authApp(t, silentLogger())
	withKey := func(body string) *http.Request {
		return jsonRequest(t, http.MethodPost, "/v1/auth/register", body, map[string]string{IdempotencyKeyHeader: "kayit-anahtari-0001"})
	}
	body := registerBodyOf(testPhone, testPassword, testFullName)

	if status, _ := send(t, app, withKey(body)); status != http.StatusCreated {
		t.Fatalf("ilk kayit 201 donmeli: %d", status)
	}
	status, header, raw := exchangeRaw(t, app, withKey(body))
	envelope := envelopeOf(t, raw)
	if status != http.StatusConflict || envelope.Error.Code != apperror.CodePhoneAlreadyRegistered || header.Get(IdempotentReplayedHeader) != "" {
		t.Errorf("tekrar 409 PHONE_ALREADY_REGISTERED almali, jetonlu cevap tekrar edilmemeli: %d %s", status, raw)
	}
	if strings.Contains(string(raw), "accessToken") {
		t.Error("tekrar cevabinda jeton olmamali")
	}

	status, envelope = send(t, app, withKey(registerBodyOf("+905321230009", testPassword, testFullName)))
	if status != http.StatusConflict || envelope.Error.Code != apperror.CodeConflict {
		t.Errorf("ayni anahtar farkli kayitla 409 CONFLICT almali: %d %+v", status, envelope)
	}
}

func TestOversizedResponseIsNotReplayedAndNoNewKeyIsSuggested(t *testing.T) {
	// 16 KB'yi asan cevap saklanmaz (bugunku uclarda olmaz). Tekrar istegi ucu
	// ikinci kez CALISTIRMAZ; 409 alir ve yeni anahtar onerilmez (istek
	// tamamlanmistir; yeni anahtar ikinci siparis olurdu).
	app := fiber.New(fiber.Config{ErrorHandler: errorHandler(silentLogger())})
	calls := 0
	app.Post("/buyuk", idempotent(testIdempotency(), mutationPolicy, silentLogger()), func(c fiber.Ctx) error {
		calls++
		return c.Status(http.StatusCreated).SendString(strings.Repeat("a", idempotencyMaxStoredBody+1))
	})
	request := func() *http.Request {
		return jsonRequest(t, http.MethodPost, "/buyuk", `{}`, map[string]string{IdempotencyKeyHeader: "buyuk-cevap-0001"})
	}

	if status, _, _ := exchangeRaw(t, app, request()); status != http.StatusCreated {
		t.Fatalf("ilk istek 201 donmeli: %d", status)
	}
	status, envelope := send(t, app, request())

	if status != http.StatusConflict || envelope.Error.Code != apperror.CodeConflict || detailsOf(t, envelope)[IdempotencyKeyHeader] != replayUnavailableReason {
		t.Errorf("409 CONFLICT ve 'tekrar edilemiyor' ayrintisi bekleniyordu: %d %+v", status, envelope)
	}
	if calls != 1 {
		t.Errorf("uc bir kez calismali, %d kez calisti", calls)
	}
}

func TestProtectedHandlerFinishesBeforeItsRecordExpires(t *testing.T) {
	// "Isleniyor" kaydi (30 sn) uc calisirken dusmemeli: ucun baglami ondan
	// kisa bir son tarih tasir, GATEWAY_REQUEST_TIMEOUT_MS ne olursa olsun.
	app := fiber.New(fiber.Config{ErrorHandler: errorHandler(silentLogger())})
	var deadline time.Time
	var hasDeadline bool
	app.Post("/sure", idempotent(testIdempotency(), mutationPolicy, silentLogger()), func(c fiber.Ctx) error {
		deadline, hasDeadline = c.Context().Deadline()
		return c.Status(http.StatusCreated).SendString(`{}`)
	})

	status, _, _ := exchangeRaw(t, app, jsonRequest(t, http.MethodPost, "/sure", `{}`, map[string]string{IdempotencyKeyHeader: "sure-siniri-0001"}))

	remaining := time.Until(deadline)
	if status != http.StatusCreated || !hasDeadline || remaining > idempotencyHandlerBudget || remaining < idempotencyHandlerBudget-5*time.Second {
		t.Errorf("uc %v son tarihle calismali: durum %d, son tarih var=%v, kalan %v", idempotencyHandlerBudget, status, hasDeadline, remaining)
	}
	if idempotencyHandlerBudget >= idempotencyInProgressTTL {
		t.Errorf("ucun son tarihi kaydin omrunden kisa olmali: %v >= %v", idempotencyHandlerBudget, idempotencyInProgressTTL)
	}
}
