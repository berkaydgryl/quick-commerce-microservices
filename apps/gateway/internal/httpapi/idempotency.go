package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// IdempotencyKeyHeader, mutasyon uclarinin zorunlu basligi (ADR-08).
const IdempotencyKeyHeader = "Idempotency-Key"

// IdempotentReplayedHeader, cevabin onceki istegin kaydindan TEKRAR edildigini
// soyler: istemci ikinci bir siparis acilmadigini buradan anlar.
const IdempotentReplayedHeader = "Idempotent-Replayed"

// Anahtar kurali (@getir/core IDEMPOTENCY_KEY_*; contracts idempotencyKeySchema):
// 8-128 karakter, yalnizca harf, rakam, '-' ve '_'. Anahtar Redis anahtarina
// girer; ':' ve '{}' ayirici oldugu icin istemciden gelemez. Degerleri
// idempotency_contract_test.go core'daki sabitlerle karsilastirir.
const (
	idempotencyKeyMinLength = 8
	idempotencyKeyMaxLength = 128
	idempotencyKeyCharset   = "A-Za-z0-9_-"
)

var idempotencyKeyPattern = regexp.MustCompile(`^[` + idempotencyKeyCharset + `]+$`)

// Sebepler.
const (
	idempotencyKeyFormatReason = "8-128 karakter olmali; yalnizca harf, rakam, - ve _"
	keyInProgressReason        = "ayni anahtarli istek hala isleniyor"
	keyReusedReason            = "bu anahtar farkli bir istekle kullanildi; yeni bir anahtar uret"
	// Yeni anahtar ONERILMEZ: istek tamamlanmistir, yeni anahtar ikinci siparis
	// demektir.
	replayUnavailableReason = "bu anahtarla istek zaten tamamlandi; cevabi saklanmadigi icin tekrar edilemiyor"
)

// Kaydin omurleri (ADR-08 eki, T8.2).
const (
	// idempotencyInProgressTTL, "isleniyor" kaydinin omru (B6: PX 30000).
	// Sure dolarsa kayit kendiliginden duser; takilan istek anahtari kilitlemez.
	idempotencyInProgressTTL = 30 * time.Second
	// idempotencyHandlerBudget, korunan ucun butun isinin son tarihi. Kayit
	// isleniyorken DUSMEMELI: dusseydi ayni anahtarli ikinci istek de
	// calisabilirdi. Cagrilar tek tek GATEWAY_REQUEST_TIMEOUT_MS ile de
	// sinirli; bu, degisken buyuk verilse bile tutan ust sinirdir (5 sn pay:
	// kaydi bitirmek icin).
	idempotencyHandlerBudget = idempotencyInProgressTTL - 5*time.Second
	// idempotencyCheckoutTTL, basarili siparis ve 3DS kaydinin omru (P5): tekrar
	// dakikalar icinde gelir; en yogun uc oldugu icin kayit kisa tutulur.
	idempotencyCheckoutTTL = 2 * time.Hour
	// idempotencyMaxStoredBody, tekrar icin saklanan cevap govdesinin ust
	// siniri. Siparis cevaplari bu sinirin cok altindadir (birkac yuz bayt).
	idempotencyMaxStoredBody = 16 * 1024
)

// Idempotency, tekrar korumasinin ayarlari (ADR-08).
type Idempotency struct {
	Store idempotency.Store
	// FingerprintKey, istek parmak izinin HMAC anahtari. Kayit govdesinde sifre
	// var; duz ozet Redis sizarsa kaba kuvvetle cozulebilirdi.
	FingerprintKey []byte
	// TTL, bitmis kaydin omru (IDEMPOTENCY_TTL_SECONDS); basarili siparis haric.
	TTL time.Duration
}

// idempotencyPolicy, bir ucun tekrar kurali.
type idempotencyPolicy struct {
	// replay, bitmis istegin cevabi saklanip aynen tekrar edilir mi? Kayit
	// ucunda HAYIR: cevap jeton tasir, jeton Redis'e yazilmaz. Tekrar istegi
	// ucun kendisine gecer (telefon benzersizligi ikinci hesabi onler).
	replay bool
	// checkout, basarili cevabin kaydi kisa omurlu mu (siparis, 3DS)?
	checkout bool
	// fingerprintBody, parmak izine giren govde; nil ise govdenin kendisi. Kart
	// ekleme (T11.17, K3) numara ve CVV tasir: kayit onlarin turevini tutmasin.
	fingerprintBody func(body []byte) []byte
	// ttl, bitmis kaydin omru; sifirsa Idempotency.TTL (kart ekleme 15 dk, K3).
	ttl time.Duration
}

var (
	registerPolicy = idempotencyPolicy{replay: false}
	mutationPolicy = idempotencyPolicy{replay: true}
	checkoutPolicy = idempotencyPolicy{replay: true, checkout: true}
)

// idempotencyKeyOf, anahtari okur; yoksa sebebi errs'e yazar.
//
// Gateway burada yalnizca VARLIGI dogrular ("anahtarsiz mutasyon 400", ADR-08):
// biciminin denetimi ve tekrar korumasi idempotent ara katmanindadir; eksik
// anahtar govdenin hatalariyla TEK cevapta donsun diye handler'da raporlanir.
func idempotencyKeyOf(c fiber.Ctx, errs fieldErrors) string {
	key := strings.TrimSpace(c.Get(IdempotencyKeyHeader))
	if key == "" {
		errs[IdempotencyKeyHeader] = requiredReason
	}
	return key
}

// idempotent, mutasyon ucunun tekrar korumasi (ADR-08 ve eki, T8.2).
//
//	anahtar yok                    -> uca gecer; uc 400 "zorunlu" der (govde hatalariyla birlikte)
//	anahtar bicimsiz               -> 400 VALIDATION_FAILED
//	anahtar bos                    -> "isleniyor" diye alinir, uc calisir, cevap kaydedilir
//	ayni istek hala isleniyor      -> 409 REQUEST_IN_PROGRESS (cift tiklama)
//	ayni istek bitmis              -> ilk cevap aynen doner + Idempotent-Replayed: true
//	ayni anahtar, FARKLI istek     -> 409 CONFLICT
//	depo ulasilamaz                -> 503 SERVICE_UNAVAILABLE (cift siparis riski alinmaz)
//
// Kaydedilmeyen cevaplar (anahtar birakilir, istemci ayni anahtarla yeniden
// dener): 5xx, 400 (dogrulama: ucun yan etkisi yok), 401 (oturum; yeniden
// girisle duzelir) ve 429 (hiz siniri).
func idempotent(settings Idempotency, policy idempotencyPolicy, logger *slog.Logger, recorder RequestMetrics) fiber.Handler {
	return func(c fiber.Ctx) error {
		raw := strings.TrimSpace(c.Get(IdempotencyKeyHeader))
		if raw == "" {
			return c.Next()
		}
		if !validIdempotencyKey(raw) {
			return apperror.New(apperror.CodeValidationFailed, map[string]string{IdempotencyKeyHeader: idempotencyKeyFormatReason})
		}

		key := idempotency.Key(idempotencyScope(c), raw)
		fingerprint := requestFingerprint(settings.FingerprintKey, c, policy)
		token := hex.EncodeToString(ids.RandomBytes(16))
		claimed, existing, err := settings.Store.Claim(c.Context(), key,
			idempotency.Record{State: idempotency.StateInProgress, Token: token, Fingerprint: fingerprint}, idempotencyInProgressTTL)
		if err != nil {
			return &apperror.Error{Code: apperror.CodeServiceUnavailable, Cause: err}
		}
		if !claimed {
			return answerExisting(c, existing, fingerprint, policy, recorder)
		}

		// Uc, kaydin omrunden kisa bir son tarihle calisir; kayit ust baglamla
		// bitirilir (ucun son tarihi dolmus olsa da yazilabilsin).
		parent := c.Context()
		budget, cancel := context.WithTimeout(parent, idempotencyHandlerBudget)
		c.SetContext(budget)
		err = c.Next()
		cancel()
		c.SetContext(parent)

		// Hata BURADA cevaba cevrilir (requestLogger ile ayni yol): kaydedilecek
		// olan, istemcinin gercekten aldigi cevaptir.
		if err != nil {
			if handlerErr := c.App().ErrorHandler(c, err); handlerErr != nil {
				release(c, settings.Store, key, token, logger)
				return handlerErr
			}
		}
		finish(c, settings, policy, key, token, fingerprint, logger)
		return nil
	}
}

// finish, ucun cevabini kaydeder ya da anahtari birakir. Cevap istemciye
// yazilmistir; buradaki depo hatasi yalnizca gunluge gider.
func finish(c fiber.Ctx, settings Idempotency, policy idempotencyPolicy, key, token, fingerprint string, logger *slog.Logger) {
	status := c.Response().StatusCode()
	if !storable(status) {
		release(c, settings.Store, key, token, logger)
		return
	}
	done := idempotency.Record{State: idempotency.StateDone, Fingerprint: fingerprint, Status: status}
	if body := c.Response().Body(); policy.replay {
		if len(body) <= idempotencyMaxStoredBody {
			// Kopya: Fiber tamponu yeniden kullanir. make, bos govdeyi de nil
			// olmayan (saklanmis) dilim yapar.
			done.Body = append(make([]byte, 0, len(body)), body...)
		} else {
			// Bugunku uclarda olmaz (cevaplar birkac yuz bayt); olursa tekrar
			// istegi 409 alir. Gunlukte gorunsun.
			logger.WarnContext(c.Context(), "idempotency: cevap saklanamayacak kadar buyuk; tekrar edilemeyecek",
				slog.String("requestId", requestIDOf(c)), slog.Int("bytes", len(body)))
		}
	}
	ttl := settings.TTL
	if policy.ttl > 0 {
		ttl = policy.ttl
	}
	if policy.checkout && status < http.StatusMultipleChoices {
		ttl = idempotencyCheckoutTTL
	}
	written, err := settings.Store.Complete(c.Context(), key, token, done, ttl)
	switch {
	case err != nil:
		logger.WarnContext(c.Context(), "idempotency kaydi yazilamadi", slog.String("requestId", requestIDOf(c)), slog.Any("err", err))
	case !written:
		// Uc "isleniyor" omrunden (30 sn) uzun surdu; kaydi artik baska bir
		// istek tutuyor ya da kayit dustu. Onun ustune yazilmaz.
		logger.WarnContext(c.Context(), "idempotency kaydi baska istege gecmis; cevap kaydedilmedi", slog.String("requestId", requestIDOf(c)))
	}
}

func release(c fiber.Ctx, store idempotency.Store, key, token string, logger *slog.Logger) {
	if _, err := store.Release(c.Context(), key, token); err != nil {
		logger.WarnContext(c.Context(), "idempotency kaydi birakilamadi", slog.String("requestId", requestIDOf(c)), slog.Any("err", err))
	}
}

// answerExisting, anahtar doluyken cevap verir. Ret ve tekrar ayri sayilir
// (#29): 409'larin anahtardan mi isten mi geldigi metrikte ayrilir.
func answerExisting(c fiber.Ctx, existing idempotency.Record, fingerprint string, policy idempotencyPolicy, recorder RequestMetrics) error {
	route := metricRoute(c)
	if !hmac.Equal([]byte(existing.Fingerprint), []byte(fingerprint)) {
		recorder.CountKeyRejection(route, keyRejectedReused)
		return apperror.New(apperror.CodeConflict, map[string]string{IdempotencyKeyHeader: keyReusedReason})
	}
	if existing.State == idempotency.StateInProgress {
		recorder.CountKeyRejection(route, keyRejectedInProgress)
		return apperror.New(apperror.CodeRequestInProgress, map[string]string{IdempotencyKeyHeader: keyInProgressReason})
	}
	if !policy.replay {
		// Kayit ucu: cevap saklanmaz, istek uca gecer (ADR-08 eki).
		return c.Next()
	}
	if existing.Body == nil {
		recorder.CountKeyRejection(route, keyRejectedReplayUnhandled)
		return apperror.New(apperror.CodeConflict, map[string]string{IdempotencyKeyHeader: replayUnavailableReason})
	}
	recorder.CountReplay(route)
	return replay(c, existing)
}

// replay, kaydedilmis cevabi yazar. Hata cevabi yeniden kurulur: govdedeki
// requestId bu istegin kimligi olmali (baslikla ayni; sozlesme kurali).
func replay(c fiber.Ctx, existing idempotency.Record) error {
	c.Set(IdempotentReplayedHeader, "true")
	var envelope struct {
		Success bool `json:"success"`
		Error   *struct {
			Code    apperror.Code `json:"code"`
			Details any           `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(existing.Body, &envelope); err == nil && !envelope.Success && envelope.Error != nil {
		return fail(c, envelope.Error.Code, envelope.Error.Details)
	}
	if len(existing.Body) > 0 {
		c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSONCharsetUTF8)
	}
	return c.Status(existing.Status).Send(existing.Body)
}

// storable, cevap kaydedilsin mi? Kaydedilmeyenlerde anahtar birakilir.
func storable(status int) bool {
	switch {
	case status >= http.StatusInternalServerError:
		return false
	case status == http.StatusBadRequest, status == http.StatusUnauthorized, status == http.StatusTooManyRequests:
		return false
	default:
		return true
	}
}

// idempotencyScope, kaydin kapsami: kullanici ya da anonim (kayit ucu).
func idempotencyScope(c fiber.Ctx) string {
	if userID := userIDOf(c); userID != "" {
		return userID
	}
	return idempotency.AnonymousScope
}

// validIdempotencyKey, anahtar bicimi (bosluk kirpilmis).
func validIdempotencyKey(key string) bool {
	return len(key) >= idempotencyKeyMinLength && len(key) <= idempotencyKeyMaxLength && idempotencyKeyPattern.MatchString(key)
}

// requestFingerprint, istegin parmak izi: yontem, yol ve govde (ucun
// politikasi verdiyse govdenin maskeli hali), sunucu sirriyla HMAC-SHA256.
func requestFingerprint(secret []byte, c fiber.Ctx, policy idempotencyPolicy) string {
	body := c.Body()
	if policy.fingerprintBody != nil {
		body = policy.fingerprintBody(body)
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(c.Method()))
	mac.Write([]byte{0})
	mac.Write([]byte(c.Path()))
	mac.Write([]byte{0})
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}
