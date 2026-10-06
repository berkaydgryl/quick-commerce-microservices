package httpapi

// Kart ekleme deneme siniri (T11.17, K2, QA S1): kart test etmeye (calinti
// numaralari dogrulama ucunda denemek) karsi.
//
//	kullanici basina BASARISIZ dogrulama -> saatte 5, gunde 20 (basari sayilmaz)
//	IP basina her deneme                -> saatte 30
//
// Esik asilinca istek kasaya GITMEDEN 429 RATE_LIMITED + Retry-After. Sayacin
// deposuna ulasilamazsa istek gecer (fail-open; genel hiz siniriyla ayni kural).
// Her denemenin sonucu card_verifications_total{result} metrigine yazilir:
// ret orani buradan okunur.

import (
	"context"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/cards"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ratelimit"
)

// Sayac rotalari (rate:{ozne}:rota): kullanici basina basarisizlik (saat, gun)
// ve IP basina deneme. Genel hiz sinirinin rotasindan (POST_/v1/me/cards) ayridir.
const (
	cardFailHourRoute = "POST_/v1/me/cards/fail-1h"
	cardFailDayRoute  = "POST_/v1/me/cards/fail-1d"
	cardIPHourRoute   = "POST_/v1/me/cards/ip-1h"
	// cardInflightRoute, kullanicinin dogrulama kilidi (rate:{usr}:...): ayni anda tek dogrulama.
	cardInflightRoute = "POST_/v1/me/cards/inflight"
)

// cardInflightTTL, dogrulama kilidinin omru: ucun suresinden (idempotencyHandlerBudget)
// uzun; gateway cokerse kilit bu surede kendiliginden duser.
const cardInflightTTL = idempotencyInProgressTTL

const day = 24 * time.Hour

// cardFailureWindows, kullanici basina basarisizlik pencereleri.
var cardFailureWindows = []struct {
	route  string
	limit  int
	length time.Duration
}{
	{cardFailHourRoute, cards.FailuresPerHour, time.Hour},
	{cardFailDayRoute, cards.FailuresPerDay, day},
}

// cardAttempts, kart eklemenin deneme siniri ve sonuc kaydi.
type cardAttempts struct {
	// failures nil ise kullanici siniri kapali; limiter nil ise IP siniri kapali.
	failures ratelimit.FailureCounter
	inflight ratelimit.InflightLock
	limiter  ratelimit.Limiter
	warning  *failOpenWarning
	recorder RequestMetrics
}

// admit, kasaya gitmeden once: esikteyse 429. IP sayaci her denemeyi yazar;
// kullanici esikteyse IP sayacina yazilmaz (reddedilen istek sayilmaz).
func (a cardAttempts) admit(c fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(c.Context(), rateLimitCallTimeout)
	defer cancel()

	if wait, limited := a.userLimited(ctx, c); limited {
		return a.reject(c, wait)
	}
	if a.limiter == nil {
		return c.Next()
	}
	ip := byClientIP(c)
	if ip == "" {
		return c.Next()
	}
	decision, err := a.limiter.Allow(ctx, ratelimit.Key(ip, cardIPHourRoute), cards.AttemptsPerIPPerHour, time.Hour)
	if err != nil {
		a.warning.warn(c, err)
		return c.Next()
	}
	if !decision.Allowed {
		return a.reject(c, decision.RetryAfter)
	}
	return c.Next()
}

// single, kullanicinin kart dogrulamalarini SIRAYA koyar (guvenlik incelemesi):
// admit'in bakmasi ile observe'un yazmasi arasinda es zamanli istekler hep bos
// sayac gorurdu ve saatte 5 / gunde 20 siniri bir patlamada asilirdi. Kilit
// doluysa 429 (Retry-After 1 sn); kilit ucun sonucu sayaca yazildiktan SONRA
// birakilir. Depoya ulasilamazsa istek gecer (fail-open).
func (a cardAttempts) single(c fiber.Ctx) error {
	if a.inflight == nil {
		return c.Next()
	}
	key := ratelimit.Key(userIDOf(c), cardInflightRoute)
	acquireCtx, cancel := context.WithTimeout(c.Context(), rateLimitCallTimeout)
	token, acquired, err := a.inflight.Acquire(acquireCtx, key, cardInflightTTL)
	cancel()
	if err != nil {
		a.warning.warn(c, err)
		return c.Next()
	}
	if !acquired {
		return a.reject(c, time.Second)
	}
	defer a.release(c, key, token)
	return c.Next()
}

// release, kilidi birakir; istegin baglami bitmis olabilir, ayri kisa baglam.
func (a cardAttempts) release(c fiber.Ctx, key, token string) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(c.Context()), rateLimitCallTimeout)
	defer cancel()
	if err := a.inflight.Release(ctx, key, token); err != nil {
		a.warning.warn(c, err)
	}
}

// userLimited, kullanicinin basarisizlik pencerelerinden biri dolu mu? Bekleme
// en uzun olanidir: kisa pencere bossa da gunluk sinir kalkmadan istek gecmez.
func (a cardAttempts) userLimited(ctx context.Context, c fiber.Ctx) (time.Duration, bool) {
	if a.failures == nil {
		return 0, false
	}
	user := userIDOf(c)
	var wait time.Duration
	limited := false
	for _, window := range cardFailureWindows {
		decision, err := a.failures.Peek(ctx, ratelimit.Key(user, window.route), window.limit, window.length)
		if err != nil {
			a.warning.warn(c, err)
			continue
		}
		if !decision.Allowed {
			limited = true
			wait = max(wait, decision.RetryAfter)
		}
	}
	return wait, limited
}

// reject, 429 RATE_LIMITED + Retry-After (genel hiz siniriyla ayni bicim).
func (a cardAttempts) reject(c fiber.Ctx, wait time.Duration) error {
	a.recorder.CountCardVerification(string(cards.OutcomeLimited))
	a.recorder.CountRateLimited(metricRoute(c))
	seconds := retryAfterSeconds(wait)
	c.Set(fiber.HeaderRetryAfter, strconv.Itoa(seconds))
	return &apperror.Error{Code: apperror.CodeRateLimited, Details: map[string]any{apperror.RetryAfterDetail: seconds}}
}

// observe, kasanin cevabini metrige ve (basarisizsa) kullanicinin sayacina yazar.
func (a cardAttempts) observe(c fiber.Ctx, err error) {
	outcome := cards.Classify(err)
	a.recorder.CountCardVerification(string(outcome))
	if !outcome.CountsAsFailure() || a.failures == nil {
		return
	}
	ctx, cancel := context.WithTimeout(c.Context(), rateLimitCallTimeout)
	defer cancel()
	user := userIDOf(c)
	for _, window := range cardFailureWindows {
		if recordErr := a.failures.Record(ctx, ratelimit.Key(user, window.route), window.length); recordErr != nil {
			a.warning.warn(c, recordErr)
		}
	}
}
