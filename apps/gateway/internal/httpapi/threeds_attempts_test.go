package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ratelimit"
)

// 3DS yanlis kod siniri (#163): yanlis kod kullanici basina saatte 5 / gunde 10,
// IP basina saatte 30 (yalniz ipLimit ile; varsayilan kapali, G1). Esikte 3DS
// onayi ve kartla siparis order'a gitmeden 429 + Retry-After; kapida odeme
// etkilenmez. Dogru kod, sure dolmasi, bicimsiz istek, tekrar ve kesinti
// sayilmaz. Sayac deposu duserse istek gecer (fail-open).

const (
	threeDSPath        = "/v1/orders/" + testOrderID + "/3ds"
	threeDSConfirmBody = `{"challengeId":"tds_1","otp":"000000"}`
	cashOnDeliveryOrd  = `{"orderId":"` + testOrderID + `","payment":{"method":"CASH_ON_DELIVERY","onDelivery":"CASH"},` +
		`"details":{"note":"","doNotRingBell":false,"agreementsAccepted":true}}`
)

// threeDSOrders, order adaptorunun sahtesi: onay sonucu confirmErr; cagrilari sayar.
type threeDSOrders struct {
	mu         sync.Mutex
	confirms   int
	places     int
	confirmErr error
}

func (f *threeDSOrders) Place(_ context.Context, input order.PlaceInput) (order.Placement, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.places++
	return order.Placement{OrderID: input.OrderID, Status: "PAID"}, nil
}

func (f *threeDSOrders) ConfirmThreeDS(_ context.Context, input order.ConfirmInput) (order.Placement, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.confirms++
	return order.Placement{OrderID: input.OrderID, Status: "PAID"}, f.confirmErr
}

func (f *threeDSOrders) counts() (confirms, places int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.confirms, f.places
}

func (f *threeDSOrders) fail(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.confirmErr = err
}

// threeDSRejection, payment-svc'nin order uzerinden gelen reddi.
func threeDSRejection(reason string) error {
	return &apperror.Error{Code: apperror.CodeThreedsFailed, Details: map[string]any{"attemptsLeft": float64(1), "reason": reason}}
}

type threeDSHarness struct {
	app      *fiber.App
	orders   *threeDSOrders
	recorder *recordingMetrics
	clock    *time.Time
	keys     int
}

// newThreeDSHarness; failures nil ise bellek sayaci (hiz siniriyla ayni depo);
// ipLimit, IP penceresi (THREEDS_IP_LIMIT_ENABLED).
func newThreeDSHarness(t *testing.T, failures ratelimit.FailureCounter, ipLimit bool) *threeDSHarness {
	t.Helper()
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	clock := &now
	counter := ratelimit.NewMemory(func() time.Time { return *clock })
	if failures == nil {
		failures = counter
	}
	orders := &threeDSOrders{}
	recorder := &recordingMetrics{}
	app := New(Deps{
		Health:           fakeReporter{report: healthyReport()},
		OrderPlacer:      orders,
		ThreeDSConfirmer: orders,
		CheckoutSignals:  &fakeSignals{},
		ThreeDSFailures:  failures,
		ThreeDSIPLimit:   ipLimit,
		AccessTokens:     testTokens(),
		Idempotency:      Idempotency{Store: idempotency.NewMemory(time.Now), FingerprintKey: testFingerprintKey, TTL: 24 * time.Hour},
		RateLimit:        RateLimit{Limiter: counter, Window: time.Minute, General: 10000, Auth: 10000, Order: 10000},
		Logger:           silentLogger(),
		Metrics:          recorder,
	})
	return &threeDSHarness{app: app, orders: orders, recorder: recorder, clock: clock}
}

// call, kullanicinin istegi; her cagri yeni Idempotency-Key (tekrar degil, yeni deneme).
func (h *threeDSHarness) call(t *testing.T, user, path, body string) (int, http.Header) {
	t.Helper()
	h.keys++
	headers := bearerFor(t, user)
	headers[IdempotencyKeyHeader] = fmt.Sprintf("anahtar-3ds-%04d", h.keys)
	response, err := h.app.Test(orderRequest(t, http.MethodPost, path, body, headers))
	if err != nil {
		t.Fatalf("istek: %v", err)
	}
	closeBody(t, response)
	return response.StatusCode, response.Header
}

func (h *threeDSHarness) advance(d time.Duration) {
	*h.clock = h.clock.Add(d)
}

func TestThreeDSWrongCodesLimitTheUserAcrossOrders(t *testing.T) {
	h := newThreeDSHarness(t, nil, false)
	h.orders.fail(threeDSRejection("wrong_code"))
	user := "usr_" + strings.Repeat("1", 32)

	for attempt := 1; attempt <= order.ThreeDSFailuresPerHour; attempt++ {
		if status, _ := h.call(t, user, threeDSPath, threeDSConfirmBody); status != http.StatusPaymentRequired {
			t.Fatalf("deneme %d: 402 THREEDS_FAILED bekleniyordu: %d", attempt, status)
		}
	}
	limited, headers := h.call(t, user, threeDSPath, threeDSConfirmBody)
	cardOrder, _ := h.call(t, user, "/v1/orders", validPlaceBody)
	cashOrder, _ := h.call(t, user, "/v1/orders", cashOnDeliveryOrd)
	otherUser, _ := h.call(t, "usr_"+strings.Repeat("9", 32), threeDSPath, threeDSConfirmBody)

	if limited != http.StatusTooManyRequests || headers.Get(fiber.HeaderRetryAfter) == "" {
		t.Errorf("6. yanlis kod denemesi order'a gitmeden 429 + Retry-After olmali: %d", limited)
	}
	if cardOrder != http.StatusTooManyRequests {
		t.Errorf("esikteki kullanici kartla yeni siparis (yeni 3DS hakki) acamamali: %d", cardOrder)
	}
	if cashOrder != http.StatusCreated {
		t.Errorf("kapida odeme etkilenmemeli: %d", cashOrder)
	}
	if otherUser != http.StatusPaymentRequired {
		t.Errorf("sayac kullanici basina: baska kullanici etkilenmemeli: %d", otherUser)
	}
	if confirms, places := h.orders.counts(); confirms != order.ThreeDSFailuresPerHour+1 || places != 1 {
		t.Errorf("order'a giden onay %d (5 + baska kullanici), siparis %d (1, yalniz kapida odeme)", confirms, places)
	}
	// Kartla siparisin reddi 3DS denemesi degil: 3DS metrigine yazilmaz.
	wrongCode, limitedAttempt := string(order.ThreeDSWrongCode), string(order.ThreeDSLimited)
	want := append(repeat(wrongCode, 5), limitedAttempt, wrongCode)
	if got := h.recorder.threeDSAttempts(); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("metrik: %v, beklenen %v", got, want)
	}
}

func TestThreeDSCountsExhaustedButNotExpiryOutageOrSuccess(t *testing.T) {
	h := newThreeDSHarness(t, nil, false)
	user := "usr_" + strings.Repeat("2", 32)
	for _, err := range []error{
		threeDSRejection("expired"),
		apperror.New(apperror.CodeServiceUnavailable, nil),
		apperror.New(apperror.CodeValidationFailed, map[string]string{"otp": "6 haneli kod olmali"}),
		nil,
	} {
		h.orders.fail(err)
		for attempt := 0; attempt < order.ThreeDSFailuresPerHour+1; attempt++ {
			if status, _ := h.call(t, user, threeDSPath, threeDSConfirmBody); status == http.StatusTooManyRequests {
				t.Fatalf("%v sayilmamali, 429 geldi", err)
			}
		}
	}

	h.orders.fail(threeDSRejection("attempts_exhausted"))
	for attempt := 0; attempt < order.ThreeDSFailuresPerHour; attempt++ {
		h.call(t, user, threeDSPath, threeDSConfirmBody)
	}
	status, _ := h.call(t, user, threeDSPath, threeDSConfirmBody)

	if status != http.StatusTooManyRequests {
		t.Errorf("son hakkin yanlis kodu (attempts_exhausted) da sayilmali: %d", status)
	}
}

func TestThreeDSHourAndDayWindows(t *testing.T) {
	h := newThreeDSHarness(t, nil, false)
	h.orders.fail(threeDSRejection("wrong_code"))
	user := "usr_" + strings.Repeat("3", 32)
	wrongCodes := func(n int) {
		for attempt := 0; attempt < n; attempt++ {
			if status, _ := h.call(t, user, threeDSPath, threeDSConfirmBody); status != http.StatusPaymentRequired {
				t.Fatalf("yanlis kod 402 olmali: %d", status)
			}
		}
	}

	wrongCodes(order.ThreeDSFailuresPerHour)
	h.advance(time.Hour + time.Minute)
	wrongCodes(order.ThreeDSFailuresPerDay - order.ThreeDSFailuresPerHour)
	h.advance(time.Hour + time.Minute)
	status, headers := h.call(t, user, threeDSPath, threeDSConfirmBody)

	if status != http.StatusTooManyRequests {
		t.Fatalf("gunde 10 yanlis koddan sonra saat dolsa da 429 olmali: %d", status)
	}
	if retry := headers.Get(fiber.HeaderRetryAfter); len(retry) < 4 {
		t.Errorf("gunluk sinirda bekleme saatlerce olmali (Retry-After sn): %q", retry)
	}
}

func TestThreeDSIPCountsWrongCodesAcrossUsers(t *testing.T) {
	h := newThreeDSHarness(t, nil, true)
	user := func(n int) string { return fmt.Sprintf("usr_%032d", n) }

	// Ayni NAT'in arkasinda dogru kod ve bicimsiz istek (bilinmeyen alan) IP hakkini tuketmez.
	for n := 0; n < order.ThreeDSFailuresPerIPPerHour+10; n++ {
		if status, _ := h.call(t, user(n), threeDSPath, threeDSConfirmBody); status != http.StatusOK {
			t.Fatalf("dogru kod %d: 200 bekleniyordu: %d", n, status)
		}
		if status, _ := h.call(t, user(n), threeDSPath, `{"challengeId":"tds_1","otp":"000000","userId":"usr_x"}`); status != http.StatusBadRequest {
			t.Fatalf("bicimsiz kod %d: 400 bekleniyordu: %d", n, status)
		}
	}
	h.orders.fail(threeDSRejection("wrong_code"))
	for n := 100; n < 100+order.ThreeDSFailuresPerIPPerHour; n++ {
		if status, _ := h.call(t, user(n), threeDSPath, threeDSConfirmBody); status != http.StatusPaymentRequired {
			t.Fatalf("yanlis kod %d: 402 bekleniyordu: %d", n, status)
		}
	}
	confirm, _ := h.call(t, user(999), threeDSPath, threeDSConfirmBody)
	cardOrder, _ := h.call(t, user(999), "/v1/orders", validPlaceBody)
	cashOrder, _ := h.call(t, user(999), "/v1/orders", cashOnDeliveryOrd)

	if confirm != http.StatusTooManyRequests || cardOrder != http.StatusTooManyRequests {
		t.Errorf("IP basina 30 yanlis koddan sonra yeni kullanicinin onayi ve kartla siparisi 429 olmali: %d, %d", confirm, cardOrder)
	}
	if cashOrder != http.StatusCreated {
		t.Errorf("kapida odeme etkilenmemeli: %d", cashOrder)
	}
	if confirms, _ := h.orders.counts(); confirms != order.ThreeDSFailuresPerIPPerHour*2+10 {
		t.Errorf("order'a giden onay %d, beklenen %d", confirms, order.ThreeDSFailuresPerIPPerHour*2+10)
	}
}

func TestThreeDSIPWindowIsOffByDefault(t *testing.T) {
	// G1: IP soketin adresidir; vekil arkasinda herkes ayni IP. Kapaliyken IP
	// sayilmaz, kullanici pencereleri yine acik.
	h := newThreeDSHarness(t, nil, false)
	h.orders.fail(threeDSRejection("wrong_code"))
	users := order.ThreeDSFailuresPerIPPerHour + 10

	for n := 0; n < users; n++ {
		if status, _ := h.call(t, fmt.Sprintf("usr_%032d", n), threeDSPath, threeDSConfirmBody); status != http.StatusPaymentRequired {
			t.Fatalf("IP penceresi kapali: %d. kullanicinin yanlis kodu order'a gitmeli (402): %d", n, status)
		}
	}
	if confirms, _ := h.orders.counts(); confirms != users {
		t.Errorf("order'a giden onay %d, beklenen %d", confirms, users)
	}
}

func TestThreeDSUserWindowsStayWithIPLimit(t *testing.T) {
	// IP penceresi acilinca kullanici pencereleri dusmez.
	h := newThreeDSHarness(t, nil, true)
	h.orders.fail(threeDSRejection("wrong_code"))
	user := "usr_" + strings.Repeat("8", 32)
	for attempt := 0; attempt < order.ThreeDSFailuresPerHour; attempt++ {
		h.call(t, user, threeDSPath, threeDSConfirmBody)
	}

	if status, _ := h.call(t, user, threeDSPath, threeDSConfirmBody); status != http.StatusTooManyRequests {
		t.Errorf("IP penceresi acikken de kullanicinin 6. yanlis kodu 429 olmali: %d", status)
	}
}

func TestThreeDSRetryAfterIsTheLongestFullWindow(t *testing.T) {
	h := newThreeDSHarness(t, nil, false)
	h.orders.fail(threeDSRejection("wrong_code"))
	user := "usr_" + strings.Repeat("6", 32)
	wrongCodes := func() {
		for attempt := 0; attempt < order.ThreeDSFailuresPerHour; attempt++ {
			h.call(t, user, threeDSPath, threeDSConfirmBody)
		}
	}

	// Gunluk pencere 10 dk sonra, saatlik pencere 1 saat sonra bosalir.
	wrongCodes()
	h.advance(day - 10*time.Minute)
	wrongCodes()
	status, headers := h.call(t, user, threeDSPath, threeDSConfirmBody)

	if status != http.StatusTooManyRequests {
		t.Fatalf("iki pencere de dolu: 429 bekleniyordu: %d", status)
	}
	if retry := headers.Get(fiber.HeaderRetryAfter); retry != "3600" {
		t.Errorf("Retry-After en uzun dolu pencere (saatlik, 3600 sn) olmali: %q", retry)
	}
}

func TestThreeDSReplayedRequestIsNotCountedTwice(t *testing.T) {
	h := newThreeDSHarness(t, nil, false)
	h.orders.fail(threeDSRejection("wrong_code"))
	user := "usr_" + strings.Repeat("4", 32)
	headers := bearerFor(t, user)
	headers[IdempotencyKeyHeader] = "anahtar-3ds-ayni"

	for attempt := 0; attempt < 3; attempt++ {
		response, err := h.app.Test(orderRequest(t, http.MethodPost, threeDSPath, threeDSConfirmBody, headers))
		if err != nil {
			t.Fatalf("istek: %v", err)
		}
		closeBody(t, response)
	}
	// Tekrar bir kez sayildiysa 4 yeni deneme daha order'a gider (402), 5.si 429.
	for attempt := 1; attempt < order.ThreeDSFailuresPerHour; attempt++ {
		if status, _ := h.call(t, user, threeDSPath, threeDSConfirmBody); status != http.StatusPaymentRequired {
			t.Fatalf("tekrardan sonra %d. yeni deneme 402 olmali (tekrar ikinci kez sayilmis): %d", attempt, status)
		}
	}
	status, _ := h.call(t, user, threeDSPath, threeDSConfirmBody)

	if confirms, _ := h.orders.counts(); confirms != order.ThreeDSFailuresPerHour {
		t.Errorf("ayni anahtar order'a bir kez gitmeli: %d onay", confirms)
	}
	if status != http.StatusTooManyRequests {
		t.Errorf("tekrar tek sayilinca 5 farkli yanlis koddan sonra 429: %d", status)
	}
	// Sinir dolduktan sonra da ayni anahtarli tekrar ilk cevabi (402) alir.
	response, err := h.app.Test(orderRequest(t, http.MethodPost, threeDSPath, threeDSConfirmBody, headers))
	if err != nil {
		t.Fatalf("istek: %v", err)
	}
	closeBody(t, response)
	if response.StatusCode != http.StatusPaymentRequired {
		t.Errorf("tekrar sinira takilmadan saklanan cevabi almali: %d", response.StatusCode)
	}
}

func TestThreeDSRejectionReleasesTheIdempotencyKey(t *testing.T) {
	h := newThreeDSHarness(t, nil, false)
	h.orders.fail(threeDSRejection("wrong_code"))
	user := "usr_" + strings.Repeat("7", 32)
	for attempt := 0; attempt < order.ThreeDSFailuresPerHour; attempt++ {
		h.call(t, user, threeDSPath, threeDSConfirmBody)
	}
	headers := bearerFor(t, user)
	headers[IdempotencyKeyHeader] = "anahtar-3ds-sinirda"
	send := func() int {
		response, err := h.app.Test(orderRequest(t, http.MethodPost, threeDSPath, threeDSConfirmBody, headers))
		if err != nil {
			t.Fatalf("istek: %v", err)
		}
		closeBody(t, response)
		return response.StatusCode
	}

	limited := send()
	h.advance(time.Hour + time.Minute)
	afterWindow := send()

	if limited != http.StatusTooManyRequests {
		t.Fatalf("sinirda 429 bekleniyordu: %d", limited)
	}
	if confirms, _ := h.orders.counts(); afterWindow != http.StatusPaymentRequired || confirms != order.ThreeDSFailuresPerHour+1 {
		t.Errorf("429 saklanmamali, anahtar serbest kalmali: pencereden sonra ayni anahtar order'a gitmeli: %d, %d onay", afterWindow, confirms)
	}
}

// brokenFailures, deposuna ulasilamayan sayac.
type brokenFailures struct{}

func (brokenFailures) Peek(context.Context, string, int, time.Duration) (ratelimit.Decision, error) {
	return ratelimit.Decision{}, errors.New("redis yok")
}

func (brokenFailures) Record(context.Context, string, time.Duration) error {
	return errors.New("redis yok")
}

func TestThreeDSCounterOutageFailsOpen(t *testing.T) {
	h := newThreeDSHarness(t, brokenFailures{}, true)
	h.orders.fail(threeDSRejection("wrong_code"))
	user := "usr_" + strings.Repeat("5", 32)

	for attempt := 0; attempt < order.ThreeDSFailuresPerHour+2; attempt++ {
		if status, _ := h.call(t, user, threeDSPath, threeDSConfirmBody); status != http.StatusPaymentRequired {
			t.Fatalf("sayac yokken istek order'a gitmeli (fail-open): %d", status)
		}
	}
}

func repeat(value string, n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = value
	}
	return out
}
