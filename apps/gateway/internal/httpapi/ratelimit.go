package httpapi

import (
	"context"
	"log/slog"
	"net/netip"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ratelimit"
)

// Hiz siniri (T8.2, roadmap P2): kayan pencere, Redis'te (MOCK'ta bellekte).
//
//	kayit ve giris                                 -> Auth sinir, IP basina (kaba kuvvet)
//	siparis uclari (rezervasyon, siparis, 3DS)     -> Order sinir, kullanici basina
//	diger /v1 uclari (yenileme ve cikis dahil)     -> General sinir; kimliksizde IP, kimlikte kullanici
//	/healthz                                       -> sinirsiz (altyapi yoklamasi)
//
// Sayim ROTA BASINADIR: her uc kendi sayacini tutar (rate:{ozne}:POST_/v1/orders).
// Kimlikli uclarda ozne kullanicidir: ayni agin (ofis, mobil operator)
// arkasindaki kullanicilar birbirinin sinirini tuketmez.
//
// Sinir asilinca 429 RATE_LIMITED, Retry-After (saniye) ve
// details.retryAfterSeconds. Sayacin deposuna ulasilamazsa istek GECER
// (fail-open): hiz siniri bir kesintide siparisi durdurmamali. Tekrar korumasi
// ise durdurur (503, ADR-08 eki); sinirlayici ondan ONCE calisir, 429 hic
// kaydedilmez.

// RateLimit, hiz sinirinin ayarlari.
type RateLimit struct {
	// Limiter nil ise sinir kapali (RATE_LIMIT_ENABLED=false).
	Limiter ratelimit.Limiter
	// Window, kayan pencerenin uzunlugu (RATE_LIMIT_WINDOW_SECONDS).
	Window time.Duration
	// Pencere basina izin verilen istek: genel, kimlik uclari, siparis uclari.
	General int
	Auth    int
	Order   int
}

// rateLimitCallTimeout, sayaca sorunun son tarihi. Sayac Redis'te milisaniye
// altinda cevap verir; Redis takilirsa istek bu kadar bekleyip GECER
// (fail-open). Istek suresinin tamamini (GATEWAY_REQUEST_TIMEOUT_MS) beklemek,
// kesintide okuma uclarini da o kadar yavaslatirdi.
const rateLimitCallTimeout = 250 * time.Millisecond

// failOpenWarnInterval, Redis'e ulasilamazken yazilan uyarinin en sik araligi.
// Kesinti boyunca her istek bir satir yazsaydi gunluk istek sayisi kadar
// buyurdu; aralikta bir satir kesintiyi gostermeye yeter.
const failOpenWarnInterval = 10 * time.Second

// rateSubject, sayacin sahibini istekten cikarir; bos donerse istek sayilmaz.
type rateSubject func(c fiber.Ctx) string

// byClientIP, istemcinin IP'si: soketin adresi (B9: istemcinin yazabildigi
// X-Forwarded-For'a guvenilmez).
func byClientIP(c fiber.Ctx) string {
	return normalizeIP(c.IP())
}

// byUser, erisim jetonundaki kullanici; kimlik ara katmanindan SONRA calisir.
func byUser(c fiber.Ctx) string {
	return userIDOf(c)
}

// normalizeIP, ayni istemciyi tek sayaca indirger: IPv4 eslemeli IPv6
// ("::ffff:10.0.0.1") IPv4'e doner, IPv6 bolge eki ("%lo0") atilir.
// Cozulemeyen deger bos doner (istek sayilmaz).
func normalizeIP(raw string) string {
	addr, err := netip.ParseAddr(raw)
	if err != nil {
		return ""
	}
	return addr.Unmap().WithZone("").String()
}

// rateLimiter, rota basina hiz siniri ara katmani uretir. Tek ornek butun
// rotalarla paylasilir: fail-open uyarisinin araligi da ortaktir.
type rateLimiter struct {
	settings RateLimit
	warning  *failOpenWarning
}

func newRateLimiter(settings RateLimit, logger *slog.Logger) rateLimiter {
	return rateLimiter{settings: settings, warning: &failOpenWarning{logger: logger, now: time.Now}}
}

// limit, verilen sinir ve ozneyle ara katman; sinir kapaliysa istegi gecirir.
func (r rateLimiter) limit(limit int, subject rateSubject) fiber.Handler {
	if r.settings.Limiter == nil {
		return func(c fiber.Ctx) error { return c.Next() }
	}
	return func(c fiber.Ctx) error {
		who := subject(c)
		if who == "" {
			return c.Next()
		}
		ctx, cancel := context.WithTimeout(c.Context(), rateLimitCallTimeout)
		decision, err := r.settings.Limiter.Allow(ctx, ratelimit.Key(who, routeLabel(c)), limit, r.settings.Window)
		cancel()
		if err != nil {
			r.warning.warn(c, err)
			return c.Next()
		}
		if !decision.Allowed {
			seconds := retryAfterSeconds(decision.RetryAfter)
			c.Set(fiber.HeaderRetryAfter, strconv.Itoa(seconds))
			return &apperror.Error{Code: apperror.CodeRateLimited, Details: map[string]any{"retryAfterSeconds": seconds}}
		}
		return c.Next()
	}
}

// routeLabel, sayacin rota parcasi: yontem + rota kalibi, "POST_/v1/orders/id/3ds".
// Yol parametresi ':' olmadan yazilir (':' Redis anahtar ayiricisidir;
// @getir/redis-kit ROUTE_PATTERN). Kalip kullanilir, gercek yol DEGIL: her
// siparis kimligi ayri sayac acsaydi sinir anlamsizlasirdi.
func routeLabel(c fiber.Ctx) string {
	return routeLabelOf(c.Method(), c.Route().Path)
}

func routeLabelOf(method, pattern string) string {
	return method + "_" + strings.ReplaceAll(pattern, ":", "")
}

// retryAfterSeconds, bekleme suresini tam saniyeye YUKARI yuvarlar (en az 1):
// Retry-After tam saniyedir; asagi yuvarlamak istemciyi erken dondururdu.
func retryAfterSeconds(wait time.Duration) int {
	seconds := int((wait + time.Second - 1) / time.Second)
	if seconds < 1 {
		return 1
	}
	return seconds
}

// failOpenWarning, sayac hatasini en fazla failOpenWarnInterval'da bir yazar.
type failOpenWarning struct {
	logger *slog.Logger
	now    func() time.Time
	// last, son uyarinin ani (UnixNano); 0 ise hic yazilmadi.
	last atomic.Int64
}

func (w *failOpenWarning) warn(c fiber.Ctx, err error) {
	now := w.now().UnixNano()
	last := w.last.Load()
	if last != 0 && now-last < int64(failOpenWarnInterval) {
		return
	}
	if !w.last.CompareAndSwap(last, now) {
		return
	}
	w.logger.WarnContext(c.Context(), "hiz siniri uygulanamadi, istek gecirildi (fail-open)",
		slog.String("requestId", requestIDOf(c)), slog.Any("err", err))
}
