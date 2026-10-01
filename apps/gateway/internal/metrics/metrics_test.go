package metrics_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/metrics"
)

// scrape, defterin /metrics ciktisi (Prometheus metin bicimi).
func scrape(t *testing.T, m *metrics.Metrics) string {
	t.Helper()
	recorder := httptest.NewRecorder()
	m.Handler().ServeHTTP(recorder, httptest.NewRequestWithContext(t.Context(), http.MethodGet, metrics.Path, nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("200 bekleniyordu: %d", recorder.Code)
	}
	body, err := io.ReadAll(recorder.Body)
	if err != nil {
		t.Fatalf("cikti okunamadi: %v", err)
	}
	return string(body)
}

func TestRecordedValuesAppearWithServiceLabel(t *testing.T) {
	m := metrics.New()

	m.ObserveRequest("/v1/orders", http.MethodPost, "OK", 30*time.Millisecond)
	m.ObserveRequest("/v1/orders", http.MethodPost, "OK", 2*time.Second)
	m.CountReplay("/v1/orders")
	m.CountKeyRejection("/v1/orders", "key_reused")
	m.CountRateLimited("/v1/auth/login")

	out := scrape(t, m)
	for _, want := range []string{
		`http_server_requests_total{code="OK",method="POST",route="/v1/orders",service="gateway"} 2`,
		`http_server_request_duration_seconds_count{code="OK",method="POST",route="/v1/orders",service="gateway"} 2`,
		`http_server_request_duration_seconds_bucket{code="OK",method="POST",route="/v1/orders",service="gateway",le="0.05"} 1`,
		`http_server_request_duration_seconds_bucket{code="OK",method="POST",route="/v1/orders",service="gateway",le="2.5"} 2`,
		`idempotency_replays_total{route="/v1/orders",service="gateway"} 1`,
		`idempotency_key_rejections_total{reason="key_reused",route="/v1/orders",service="gateway"} 1`,
		`rate_limit_rejections_total{route="/v1/auth/login",service="gateway"} 1`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("ciktida yok: %s", want)
		}
	}
}

func TestRuntimeMetricsCarryServiceLabelToo(t *testing.T) {
	out := scrape(t, metrics.New())

	if !strings.Contains(out, `go_goroutines{service="gateway"}`) {
		t.Errorf("Go calisma zamani metrikleri service etiketiyle gelmeli")
	}
}

func TestEachInstanceHasItsOwnRegistry(t *testing.T) {
	// Kuresel defter yok: testler (ve iki ornek) birbirinin sayacini gormez.
	first, second := metrics.New(), metrics.New()

	first.CountReplay("/v1/orders")

	if strings.Contains(scrape(t, second), "idempotency_replays_total{") {
		t.Error("ikinci ornegin defteri bos olmali")
	}
}
