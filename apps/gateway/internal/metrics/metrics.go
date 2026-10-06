// Package metrics, gateway'in Prometheus metrikleri (#29). Kurallar Node
// servisleriyle (T10.5, @getir/observability) aynidir:
//
//   - ad oneki yok; servis her metrikteki service="gateway" etiketiyle ayrilir,
//   - birim adin sonunda (_seconds, _total),
//   - etiket degeri KAPALI bir kumeden: rota kalibi, yontem, hata kodu, sebep.
//     Kimlik, IP, sorgu ve ham yol etiket OLMAZ (sayisiz seri; kisisel veri).
//
// Defter bu yapiya aittir, kuresel degildir: testler kendi defterini kurar,
// main tek ornek kurar ve /metrics ucuna verir (server.go).
package metrics

import (
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ServiceName, her metrikteki service etiketi (Node'daki setServiceLabel karsiligi).
const ServiceName = "gateway"

// Metrik adlari; Node'daki grpc_server_* ile ayni bicim.
const (
	RequestsName      = "http_server_requests_total"
	DurationName      = "http_server_request_duration_seconds"
	ReplaysName       = "idempotency_replays_total"
	KeyRejectionsName = "idempotency_key_rejections_total"
	RateLimitedName   = "rate_limit_rejections_total"
	// CardVerificationsName, kart ekleme denemeleri (T11.17, K2); service="gateway" etiketiyle.
	CardVerificationsName = "card_verifications_total"
)

// durationBuckets, Node'daki DURATION_BUCKETS_SECONDS ile ayni (5 ms - 10 sn).
var durationBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

// Metrics, gateway'in metrikleri ve defteri.
type Metrics struct {
	registry      *prometheus.Registry
	requests      *prometheus.CounterVec
	duration      *prometheus.HistogramVec
	replays       *prometheus.CounterVec
	keyRejections *prometheus.CounterVec
	rateLimited   *prometheus.CounterVec
	cardResults   *prometheus.CounterVec
}

// New, defteri ve metrikleri kurar; Go calisma zamani ve surec metrikleri dahil.
func New() *Metrics {
	requestLabels := []string{"route", "method", "code"}
	m := &Metrics{
		registry: prometheus.NewRegistry(),
		requests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: RequestsName,
			Help: "Tamamlanan HTTP istekleri; code: OK ya da hata kodu",
		}, requestLabels),
		duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    DurationName,
			Help:    "HTTP isteginin gateway'deki suresi (sn), servis cagrilari dahil",
			Buckets: durationBuckets,
		}, requestLabels),
		replays: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: ReplaysName,
			Help: "Tekrar korumasinin kayittan aynen tekrar ettigi cevaplar (Idempotent-Replayed)",
		}, []string{"route"}),
		keyRejections: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: KeyRejectionsName,
			Help: "Anahtar yuzunden reddedilen istekler (409); reason: key_reused, in_progress, replay_unavailable",
		}, []string{"route", "reason"}),
		rateLimited: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: RateLimitedName,
			Help: "Hiz sinirina takilan istekler (429)",
		}, []string{"route"}),
		cardResults: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: CardVerificationsName,
			Help: "Kart ekleme denemeleri; result: approved, declined, invalid, limited, other",
		}, []string{"result"}),
	}
	registerer := prometheus.WrapRegistererWith(prometheus.Labels{"service": ServiceName}, m.registry)
	registerer.MustRegister(
		m.requests, m.duration, m.replays, m.keyRejections, m.rateLimited, m.cardResults,
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)
	return m
}

// ObserveRequest, tamamlanan istegi sayar ve suresini kaydeder.
func (m *Metrics) ObserveRequest(route, method, code string, elapsed time.Duration) {
	m.requests.WithLabelValues(route, method, code).Inc()
	m.duration.WithLabelValues(route, method, code).Observe(elapsed.Seconds())
}

// CountReplay, kayittan tekrar edilen cevabi sayar.
func (m *Metrics) CountReplay(route string) {
	m.replays.WithLabelValues(route).Inc()
}

// CountKeyRejection, anahtar yuzunden reddedilen istegi sebebiyle sayar.
func (m *Metrics) CountKeyRejection(route, reason string) {
	m.keyRejections.WithLabelValues(route, reason).Inc()
}

// CountRateLimited, hiz sinirina takilan istegi sayar.
func (m *Metrics) CountRateLimited(route string) {
	m.rateLimited.WithLabelValues(route).Inc()
}

// CountCardVerification, kart ekleme denemesinin sonucunu sayar (T11.17).
func (m *Metrics) CountCardVerification(result string) {
	m.cardResults.WithLabelValues(result).Inc()
}

// Handler, defterin Prometheus metin bicimi; toplama hatasi 500 doner.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}
