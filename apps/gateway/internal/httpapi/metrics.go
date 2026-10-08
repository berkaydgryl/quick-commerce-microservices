package httpapi

import (
	"net/http"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// RequestMetrics, istek metriklerinin yazildigi yer (#29; uygulamasi
// internal/metrics). Verilmezse metrik yazilmaz (testlerin cogu).
//
// Etiket degerleri KAPALI kumedendir: rota kalibi (eslesmeyen yol
// "unmatched"), bilinen yontemler (gerisi "OTHER"), "OK" ya da hata sozlugu
// kodu, sebep sabitleri. Kimlik, IP ve ham yol etiket olmaz.
type RequestMetrics interface {
	ObserveRequest(route, method, code string, elapsed time.Duration)
	CountReplay(route string)
	CountKeyRejection(route, reason string)
	CountRateLimited(route string)
	// CountCardVerification, kart ekleme denemesinin sonucu (T11.17, K2):
	// approved, declined, invalid, limited, other. Ret orani buradan.
	CountCardVerification(result string)
	// CountThreeDSAttempt, 3DS onay denemesinin sonucu (#163): succeeded,
	// wrong_code, expired, limited, other. Yanlis kod orani buradan.
	CountThreeDSAttempt(result string)
}

// noMetrics, metrik verilmediginde kullanilir: hicbir sey yazmaz.
type noMetrics struct{}

func (noMetrics) ObserveRequest(string, string, string, time.Duration) {}
func (noMetrics) CountReplay(string)                                   {}
func (noMetrics) CountKeyRejection(string, string)                     {}
func (noMetrics) CountRateLimited(string)                              {}
func (noMetrics) CountCardVerification(string)                         {}
func (noMetrics) CountThreeDSAttempt(string)                           {}

// Anahtar reddinin sebepleri (idempotency_key_rejections_total{reason}).
const (
	keyRejectedReused          = "key_reused"
	keyRejectedInProgress      = "in_progress"
	keyRejectedReplayUnhandled = "replay_unavailable"
)

const (
	// metricOK, basarili istegin code etiketi (Node'daki RPC_OK_CODE).
	metricOK = "OK"
	// unmatchedRoute, rotasi olmayan istegin etiketi: her yol ayri seri acmasin.
	unmatchedRoute = "unmatched"
	// otherMethod, bilinmeyen yontemin etiketi (istemci keyfi yontem gonderebilir).
	otherMethod = "OTHER"
)

var knownMethods = map[string]bool{
	http.MethodGet: true, http.MethodHead: true, http.MethodPost: true, http.MethodPut: true,
	http.MethodPatch: true, http.MethodDelete: true, http.MethodOptions: true,
}

// responseCodeKey, fail()'in yazdigi hata kodunu metrik icin tasir.
type responseCodeKey struct{}

// pendingMetricsKey, Fiber'in sunucu hatasi on gecisinde istegin baslangic
// anini tasir (istek satiri ve span gibi; middleware.go, tracing.go).
type pendingMetricsKey struct{}

// metricsMiddleware, her istegi sayar ve suresini kaydeder (#29). Zincirde
// izden sonra, istek gunlugunden ONCE durur: gunluk hatayi cevaba cevirdikten
// sonra son durum ve kod okunur. /healthz de sayilir (yoklama sikligi gorunur).
func metricsMiddleware(recorder RequestMetrics) fiber.Handler {
	return func(c fiber.Ctx) error {
		startedAt := time.Now()
		err := c.Next()
		if _, pending := c.Locals(pendingRequestLogKey{}).(time.Time); pending {
			// On gecis: cevabi hata isleyici SONRA yazar, metrik orada (errors.go).
			c.Locals(pendingMetricsKey{}, startedAt)
			return err
		}
		observeRequest(c, recorder, startedAt)
		return err
	}
}

// observePendingRequest, on gecisteki istegin metrigini cevap yazildiktan sonra yazar.
func observePendingRequest(c fiber.Ctx, recorder RequestMetrics) {
	if startedAt, pending := c.Locals(pendingMetricsKey{}).(time.Time); pending {
		c.Locals(pendingMetricsKey{}, nil)
		observeRequest(c, recorder, startedAt)
	}
}

func observeRequest(c fiber.Ctx, recorder RequestMetrics, startedAt time.Time) {
	recorder.ObserveRequest(metricRoute(c), metricMethod(c.Method()), responseCode(c), time.Since(startedAt))
}

// metricRoute, rota kalibi ("/v1/orders/:id"); eslesmeyen yolda "unmatched".
func metricRoute(c fiber.Ctx) string {
	if c.Matched() {
		return c.Route().Path
	}
	return unmatchedRoute
}

func metricMethod(method string) string {
	if knownMethods[method] {
		return method
	}
	return otherMethod
}

// responseCode, cevabin kodu: hata zarfi yazildiysa sozluk kodu, yoksa "OK".
func responseCode(c fiber.Ctx) string {
	if code, written := c.Locals(responseCodeKey{}).(apperror.Code); written {
		return string(code)
	}
	if status := c.Response().StatusCode(); status >= http.StatusBadRequest {
		return string(classify(status))
	}
	return metricOK
}
