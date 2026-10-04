// Package verification, tek kullanimlik dogrulama kodunun KANALDAN BAGIMSIZ
// parcasidir (T11.14 PR 3'te emailverify'dan ayrildi): kurallar, kod uretimi ve
// ozeti, bekleyen kodun deposu (Redis Lua + bellek) ve cevap hatalari. Kanalin
// kendisi (e-posta: emailverify, telefon: phoneverify) adresi, iletiyi ve
// hesaba yazimi bilir.
//
//	rules.go  - kod kurallari, alan adi, cumleler ve hata cevaplari
//	code.go   - kod uretimi ve kodun ozeti (HMAC)
//	store.go  - bekleyen dogrulamanin deposu (arayuz ve sonuclar)
//	redis.go  - depo: Redis, kanal basina tek hash + Lua (verify:<kanal>:{usr_...})
//	memory.go - depo: bellek (MOCK ve testler)
package verification

import (
	"fmt"
	"math"
	"regexp"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// Kurallar: @getir/contracts ile AYNI (constants.ts: OTP_PATTERN,
// VERIFICATION_CODE_TTL_SECONDS, VERIFICATION_CODE_MAX_ATTEMPTS,
// VERIFICATION_CODE_RESEND_SECONDS; kullanicinin karari A2). Iki kanal da ayni
// kurali uygular. contract_test.go iki tarafi karsilastirir.
const (
	// CodeTTL, kodun gecerliligi (10 dakika).
	CodeTTL = 600 * time.Second
	// MaxAttempts, kodun iptal edildigi yanlis deneme sayisi.
	MaxAttempts = 5
	// ResendAfter, yeni kod icin en kisa bekleme.
	ResendAfter = 60 * time.Second

	codePattern = `^[0-9]{6}$`
	// codeDigits, kodun rakam sayisi (codePattern ile ayni).
	codeDigits = 6
)

var codeRegexp = regexp.MustCompile(codePattern)

// FieldCode, kod alaninin adi: istek govdesindekiyle ayni.
const FieldCode = "code"

// Cumleler: istemcinin alanin altinda gordugu sebepler. CodeReason
// sozlesmedekiyle birebir aynidir (contract_test); gerisi yalnizca sunucunun
// bildigi kurallardir.
const (
	// CodeReason, kodun bicimi (sozlesme: VERIFICATION_CODE_MESSAGE).
	CodeReason = "Kod 6 rakam olmalı"

	codeExpiredReason = "Kodun süresi doldu. Yeni kod isteyebilirsin."
	codeLockedReason  = "Kod 5 kez hatalı girildi. Yeni kod isteyebilirsin."
	// codeWrongFormat, kalan hakla: "Kod hatalı. 3 deneme hakkın kaldı."
	codeWrongFormat = "Kod hatalı. %d deneme hakkın kaldı."
)

// ValidCode, kodun bicimi dogru mu (tam 6 rakam).
func ValidCode(code string) bool {
	return codeRegexp.MatchString(code)
}

// Rejection, dogrulanmamis denemenin cevabi: kod alaninda VALIDATION_FAILED
// (yanlis kod kalan hakla, kilit, suresi dolmus). Dogru kodda nil.
func Rejection(outcome Outcome) error {
	switch outcome.Result {
	case ResultVerified:
		return nil
	case ResultWrong:
		return rejectCode(fmt.Sprintf(codeWrongFormat, outcome.AttemptsLeft))
	case ResultLocked:
		return rejectCode(codeLockedReason)
	default:
		return rejectCode(codeExpiredReason)
	}
}

func rejectCode(reason string) error {
	return apperror.New(apperror.CodeValidationFailed, map[string]string{FieldCode: reason})
}

// TooSoon, yeni kod icin bekleme bitmedi: 429 RATE_LIMITED ve tam saniyeye
// YUKARI yuvarlanmis bekleme (hiz siniriyla ayni bicim; httpapi Retry-After
// basligini buradan yazar).
func TooSoon(wait time.Duration) error {
	seconds := int(math.Ceil(wait.Seconds()))
	return &apperror.Error{Code: apperror.CodeRateLimited, Details: map[string]any{apperror.RetryAfterDetail: max(seconds, 1)}}
}

// Unavailable, depo ya da ileti sunucusu cevap vermedi: istemci tekrar dener.
func Unavailable(err error) error {
	return &apperror.Error{Code: apperror.CodeServiceUnavailable, Cause: err}
}
