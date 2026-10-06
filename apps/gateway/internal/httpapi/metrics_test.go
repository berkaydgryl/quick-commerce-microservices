package httpapi

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// Istek metrikleri (#29): etiketler kapali kumeden; kod OK ya da hata kodu;
// tekrar, anahtar reddi ve 429 ayri sayilir. Kaydeden sahte yazici; Prometheus
// bicimi ve /metrics ucu internal/metrics'te sinanir.

type recordedRequest struct {
	route, method, code string
}

type recordingMetrics struct {
	mu            sync.Mutex
	requests      []recordedRequest
	replays       []string
	keyRejections []string
	rateLimited   []string
	cardResults   []string
}

func (m *recordingMetrics) ObserveRequest(route, method, code string, _ time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.requests = append(m.requests, recordedRequest{route: route, method: method, code: code})
}

func (m *recordingMetrics) CountReplay(route string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.replays = append(m.replays, route)
}

func (m *recordingMetrics) CountKeyRejection(route, reason string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.keyRejections = append(m.keyRejections, route+" "+reason)
}

func (m *recordingMetrics) CountRateLimited(route string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rateLimited = append(m.rateLimited, route)
}

func (m *recordingMetrics) CountCardVerification(result string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cardResults = append(m.cardResults, result)
}

func (m *recordingMetrics) cardVerifications() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.cardResults...)
}

func (m *recordingMetrics) recorded() []recordedRequest {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]recordedRequest(nil), m.requests...)
}

func withMetrics(recorder RequestMetrics) func(*Deps) {
	return func(deps *Deps) { deps.Metrics = recorder }
}

func TestRequestMetricsLabelRouteTemplateMethodAndCode(t *testing.T) {
	recorder := &recordingMetrics{}
	app := limitedApp(t, RateLimit{}, &fakeOrders{}, silentLogger(), withMetrics(recorder))

	getStatus(t, app, "/v1/categories", nil)
	getStatus(t, app, "/v1/orders/ord_bir-kimlik", nil)
	getStatus(t, app, "/healthz", nil)

	want := []recordedRequest{
		{route: "/v1/categories", method: http.MethodGet, code: metricOK},
		// Kimlik parcasi etikete girmez: rota kalibi.
		{route: "/v1/orders/:id", method: http.MethodGet, code: string(apperror.CodeUnauthorized)},
		{route: "/healthz", method: http.MethodGet, code: metricOK},
	}
	if got := recorder.recorded(); !equalRequests(got, want) {
		t.Errorf("metrik etiketleri yanlis:\n%v\nbeklenen:\n%v", got, want)
	}
}

func TestRequestMetricsKeepLabelSetsClosed(t *testing.T) {
	// Rastgele yol ve yontem yeni seri acmamali: "unmatched" ve "OTHER".
	// (Fiber'in tanimadigi yontemi ara katmanlardan once reddeder; TRACE ve
	// CONNECT gibi tanidigi ama bizim kullanmadigimiz yontemler buraya gelir.)
	recorder := &recordingMetrics{}
	app := limitedApp(t, RateLimit{}, &fakeOrders{}, silentLogger(), withMetrics(recorder))

	getStatus(t, app, "/yok/ord_bir-kimlik?lat=40.98", nil)
	response, err := app.Test(newRequest(t, http.MethodTrace, "/v1/categories", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	closeBody(t, response)

	got := recorder.recorded()
	if len(got) != 2 || got[0] != (recordedRequest{route: unmatchedRoute, method: http.MethodGet, code: string(apperror.CodeNotFound)}) {
		t.Fatalf("eslesmeyen yol 'unmatched' ve NOT_FOUND olmali: %v", got)
	}
	if got[1].method != otherMethod || got[1].route != unmatchedRoute {
		t.Errorf("bilinmeyen yontem 'OTHER', yol 'unmatched' olmali: %v", got[1])
	}
}

func TestRateLimitedRequestIsCountedSeparately(t *testing.T) {
	recorder := &recordingMetrics{}
	app := limitedApp(t, memoryLimits(newTestClock(), 1, 10, 20), &fakeOrders{}, silentLogger(), withMetrics(recorder))

	getStatus(t, app, "/v1/categories", nil)
	status, _, _ := getStatus(t, app, "/v1/categories", nil)

	if status != http.StatusTooManyRequests {
		t.Fatalf("ikinci istek 429 almali: %d", status)
	}
	got := recorder.recorded()
	if len(recorder.rateLimited) != 1 || recorder.rateLimited[0] != "/v1/categories" ||
		len(got) != 2 || got[1].code != string(apperror.CodeRateLimited) {
		t.Errorf("429 rota basina sayilmali ve istek RATE_LIMITED kodlu olmali: %v %v", recorder.rateLimited, got)
	}
}

func TestReplayAndReusedKeyAreCountedSeparately(t *testing.T) {
	recorder := &recordingMetrics{}
	orders := &fakeOrders{}
	app := New(Deps{
		Health: fakeReporter{report: healthyReport()}, CartReserver: orders, OrderPlacer: orders,
		CheckoutSignals: &fakeSignals{}, AccessTokens: testTokens(), Idempotency: testIdempotency(),
		Logger: silentLogger(), Metrics: recorder,
	})

	send(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", validReserveBody, nil))
	send(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", validReserveBody, nil))
	other := `{"marketId":"mkt_baska","items":[{"productId":"prd_01","quantity":1}],"address":{"line":"Kadikoy","location":{"lat":40.99,"lng":29.02}},"expectedTotal":{"amountMinor":100,"currency":"TRY"}}`
	status, _ := send(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", other, nil))

	if status != http.StatusConflict {
		t.Fatalf("ayni anahtar farkli govde 409 almali: %d", status)
	}
	if len(recorder.replays) != 1 || recorder.replays[0] != "/v1/cart/reserve" {
		t.Errorf("ikinci istek tekrar olarak sayilmali: %v", recorder.replays)
	}
	if len(recorder.keyRejections) != 1 || recorder.keyRejections[0] != "/v1/cart/reserve "+keyRejectedReused {
		t.Errorf("farkli govde key_reused sayilmali: %v", recorder.keyRejections)
	}
}

func TestOversizedBodyIsCountedOnceWithFinalCode(t *testing.T) {
	// Fiber'in on gecisi (gövde siniri): metrik de istek satiri ve span gibi
	// bekletilir, hata isleyici son durumla bir kez yazar.
	recorder := &recordingMetrics{}
	app := limitedApp(t, RateLimit{}, &fakeOrders{}, silentLogger(), withMetrics(recorder))
	dialer := net.Dialer{Timeout: ioDeadline}
	conn, err := dialer.DialContext(t.Context(), "tcp", serveOnLoopback(t, app))
	if err != nil {
		t.Fatalf("baglanilamadi: %v", err)
	}
	t.Cleanup(func() {
		if closeErr := conn.Close(); closeErr != nil {
			t.Errorf("baglanti kapatilamadi: %v", closeErr)
		}
	})
	if err = conn.SetDeadline(time.Now().Add(ioDeadline)); err != nil {
		t.Fatalf("son tarih konamadi: %v", err)
	}
	head := "POST /v1/cart/reserve HTTP/1.1\r\n" +
		"Host: gateway\r\n" +
		fiber.HeaderContentType + ": " + fiber.MIMEApplicationJSON + "\r\n" +
		fiber.HeaderContentLength + ": " + strconv.Itoa(maxBodyBytes+1) + "\r\n\r\n"
	if _, err = io.WriteString(conn, head); err != nil {
		t.Fatalf("istek yazilamadi: %v", err)
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("cevap okunamadi: %v", err)
	}
	closeBody(t, response)

	want := []recordedRequest{{route: unmatchedRoute, method: http.MethodPost, code: string(apperror.CodeValidationFailed)}}
	if got := recorder.recorded(); !equalRequests(got, want) {
		t.Errorf("tek kayit ve son kod bekleniyordu: %v", got)
	}
}

func equalRequests(got, want []recordedRequest) bool {
	if len(got) != len(want) {
		return false
	}
	for index := range want {
		if got[index] != want[index] {
			return false
		}
	}
	return true
}
