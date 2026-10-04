package httpapi

import (
	"net/http"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// Profil duzenleme (T11.14 PR 3; openapi: updateMe, sendPhoneVerificationCode,
// verifyPhone). Ucu de kalici bir sey degistirir: Idempotency-Key ister
// (ADR-08). Ad degistirme genel sinirda; telefon uclari kimlik sinirinda
// (kullanici basina): sifre denemesi ve baskasinin numarasina SMS yagdirma.

// updateProfileHandler, PATCH /v1/me: adi degistirir, guncel profili doner (#89).
func updateProfileHandler(updater ProfileUpdater) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		var body profileUpdateBody
		if err := decodeJSONBody(c, &body); err != nil {
			return err
		}
		errs := fieldErrors{}
		idempotencyKeyOf(c, errs)
		input := body.toInput(errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		profile, err := updater.UpdateProfile(c.Context(), userIDOf(c), input)
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, profile)
	}
}

// sendPhoneCodeHandler, POST /v1/me/phone/code: numaraya 6 haneli kod (SMS).
// Baska numaraya gecerken sifre ister. 202: mesaj yola cikti; yeni kod icin
// bekleme bitmediyse 429 ve Retry-After.
func sendPhoneCodeHandler(sender PhoneCodeSender) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		var body phoneCodeBody
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

// verifyPhoneHandler, POST /v1/me/phone/verify: kodu dogrular, numarayi yazar.
// Numara degistiyse bu oturum disindaki oturumlar kapanir (kimlik jetondan).
func verifyPhoneHandler(verifier PhoneVerifier) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		var body phoneVerifyBody
		if err := decodeJSONBody(c, &body); err != nil {
			return err
		}
		errs := fieldErrors{}
		idempotencyKeyOf(c, errs)
		input := body.toInput(errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		profile, err := verifier.Verify(c.Context(), identityOf(c), input)
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, profile)
	}
}
