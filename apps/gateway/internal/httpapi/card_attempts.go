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
	"time"

	"github.com/gofiber/fiber/v3"

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

// cardFailureWindows, kullanici basina basarisizlik pencereleri.
var cardFailureWindows = []attemptWindow{
	{route: cardFailHourRoute, limit: cards.FailuresPerHour, length: time.Hour},
	{route: cardFailDayRoute, limit: cards.FailuresPerDay, length: day},
}

// cardAttempts, kart eklemenin deneme siniri ve sonuc kaydi.
type cardAttempts struct {
	gate     attemptGate
	inflight ratelimit.InflightLock
	warning  *failOpenWarning
	recorder RequestMetrics
}

// newCardAttempts, kart rotalarinin deneme kapisi; sayaclar nil ise ilgili sinir kapali.
func newCardAttempts(routes CardRoutes, deps cardRouteDeps) cardAttempts {
	return cardAttempts{
		gate: attemptGate{
			windows:  cardFailureWindows,
			ipRoute:  cardIPHourRoute,
			ipLimit:  cards.AttemptsPerIPPerHour,
			failures: routes.Failures,
			limiter:  deps.limits.settings.Limiter,
			warning:  deps.limits.warning,
		},
		inflight: routes.Inflight,
		warning:  deps.limits.warning,
		recorder: deps.recorder,
	}
}

// admit, kasaya gitmeden once: kullanici ya da IP esikteyse 429.
func (a cardAttempts) admit(c fiber.Ctx) error {
	if wait, limited := a.gate.check(c); limited {
		return a.reject(c, wait)
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

// reject, 429 RATE_LIMITED + Retry-After; sonuc metrige "limited" yazilir.
func (a cardAttempts) reject(c fiber.Ctx, wait time.Duration) error {
	a.recorder.CountCardVerification(string(cards.OutcomeLimited))
	return rejectAttempt(c, a.recorder, wait)
}

// observe, kasanin cevabini metrige ve (basarisizsa) kullanicinin sayacina yazar.
func (a cardAttempts) observe(c fiber.Ctx, err error) {
	outcome := cards.Classify(err)
	a.recorder.CountCardVerification(string(outcome))
	if outcome.CountsAsFailure() {
		a.gate.recordFailure(c)
	}
}
