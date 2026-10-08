package httpapi

// Deneme kapisi: kullanici (ya da IP) basina BASARISIZLIK pencereleri ve
// istege bagli IP basina her deneme. Kart ekleme (T11.17, K2) ve 3DS onayi
// (#163) ayni kapidan gecer. Bakmak sayaca yazmaz (Peek); sonuc ucun cevabindan
// sonra yazilir. Sayacin deposuna ulasilamazsa istek gecer (fail-open; genel hiz
// siniriyla ayni kural).

import (
	"context"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ratelimit"
)

const day = 24 * time.Hour

// attemptWindow, bir basarisizlik penceresi: kullanici basina (rate:{usr}:rota)
// ya da perIP ise IP basina (rate:{ip}:rota).
type attemptWindow struct {
	route  string
	limit  int
	length time.Duration
	perIP  bool
}

// subject, pencerenin sayilan oznesi; bos ise pencere atlanir.
func (w attemptWindow) subject(c fiber.Ctx) string {
	if w.perIP {
		return byClientIP(c)
	}
	return userIDOf(c)
}

// attemptGate, bir ucun deneme kapisi.
type attemptGate struct {
	windows []attemptWindow
	// ipRoute ve ipLimit, IP basina saatlik HER deneme sayaci (limiter ile).
	ipRoute string
	ipLimit int
	// failures nil ise basarisizlik pencereleri kapali; limiter nil ise her
	// deneme sayaci kapali.
	failures ratelimit.FailureCounter
	limiter  ratelimit.Limiter
	warning  *failOpenWarning
}

// check, istek gecmeden once: basarisizlik pencerelerinden biri doluysa ya da
// IP her deneme sayaci esikteyse bekleme ve true. Her deneme sayaci denemeyi
// YAZAR; pencere doluysa yazilmaz (reddedilen istek sayilmaz).
func (g attemptGate) check(c fiber.Ctx) (time.Duration, bool) {
	ctx, cancel := context.WithTimeout(c.Context(), rateLimitCallTimeout)
	defer cancel()

	if wait, limited := g.failuresLimited(ctx, c); limited {
		return wait, true
	}
	if g.limiter == nil {
		return 0, false
	}
	ip := byClientIP(c)
	if ip == "" {
		return 0, false
	}
	decision, err := g.limiter.Allow(ctx, ratelimit.Key(ip, g.ipRoute), g.ipLimit, time.Hour)
	if err != nil {
		g.warning.warn(c, err)
		return 0, false
	}
	return decision.RetryAfter, !decision.Allowed
}

// failuresLimited, basarisizlik pencerelerinden biri dolu mu? Bekleme en uzun
// olanidir: kisa pencere bossa da gunluk sinir kalkmadan istek gecmez.
func (g attemptGate) failuresLimited(ctx context.Context, c fiber.Ctx) (time.Duration, bool) {
	if g.failures == nil {
		return 0, false
	}
	var wait time.Duration
	limited := false
	for _, window := range g.windows {
		subject := window.subject(c)
		if subject == "" {
			continue
		}
		decision, err := g.failures.Peek(ctx, ratelimit.Key(subject, window.route), window.limit, window.length)
		if err != nil {
			g.warning.warn(c, err)
			continue
		}
		if !decision.Allowed {
			limited = true
			wait = max(wait, decision.RetryAfter)
		}
	}
	return wait, limited
}

// recordFailure, basarisiz denemeyi her pencereye (kendi oznesiyle) yazar.
func (g attemptGate) recordFailure(c fiber.Ctx) {
	if g.failures == nil {
		return
	}
	ctx, cancel := context.WithTimeout(c.Context(), rateLimitCallTimeout)
	defer cancel()
	for _, window := range g.windows {
		subject := window.subject(c)
		if subject == "" {
			continue
		}
		if err := g.failures.Record(ctx, ratelimit.Key(subject, window.route), window.length); err != nil {
			g.warning.warn(c, err)
		}
	}
}

// rejectAttempt, 429 RATE_LIMITED + Retry-After (genel hiz siniriyla ayni bicim).
func rejectAttempt(c fiber.Ctx, recorder RequestMetrics, wait time.Duration) error {
	recorder.CountRateLimited(metricRoute(c))
	seconds := retryAfterSeconds(wait)
	c.Set(fiber.HeaderRetryAfter, strconv.Itoa(seconds))
	return &apperror.Error{Code: apperror.CodeRateLimited, Details: map[string]any{apperror.RetryAfterDetail: seconds}}
}
