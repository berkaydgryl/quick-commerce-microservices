package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// E-posta dogrulama (T11.14; openapi: sendEmailVerificationCode, verifyEmail).
// Ikisi de kalici bir sey degistirir (kod yazilir, ileti gider; adres hesaba
// yazilir): Idempotency-Key ister (ADR-08). Ag tekrari ikinci ileti gondermez,
// ayni cevabi alir. Hiz siniri kimlik uclarininkidir (kullanici basina).

// sendEmailCodeHandler, POST /v1/me/email/code: adrese 6 haneli kod gonderir.
// 202: ileti yola cikti. Yeni kod icin bekleme bitmediyse 429 ve Retry-After.
func sendEmailCodeHandler(sender EmailCodeSender) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		var body emailCodeBody
		if err := decodeJSONBody(c, &body); err != nil {
			return err
		}
		errs := fieldErrors{}
		idempotencyKeyOf(c, errs)
		input := body.toInput(errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		sent, err := sender.SendCode(c.Context(), userIDOf(c), input)
		if err != nil {
			setRetryAfter(c, err)
			return err
		}
		return private(c, http.StatusAccepted, sent)
	}
}

// verifyEmailHandler, POST /v1/me/email/verify: kodu dogrular, adresi hesaba
// yazar ve guncel profili doner.
func verifyEmailHandler(verifier EmailVerifier) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		var body emailVerifyBody
		if err := decodeJSONBody(c, &body); err != nil {
			return err
		}
		errs := fieldErrors{}
		idempotencyKeyOf(c, errs)
		input := body.toInput(errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		profile, err := verifier.Verify(c.Context(), userIDOf(c), input)
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, profile)
	}
}

// setRetryAfter, servisin RATE_LIMITED hatasindaki beklemeyi Retry-After
// basligina yazar (hiz sinirinin cevabiyla ayni bicim).
func setRetryAfter(c fiber.Ctx, err error) {
	var appErr *apperror.Error
	if !errors.As(err, &appErr) || appErr.Code != apperror.CodeRateLimited {
		return
	}
	if seconds, ok := appErr.Details[apperror.RetryAfterDetail].(int); ok {
		c.Set(fiber.HeaderRetryAfter, strconv.Itoa(seconds))
	}
}
