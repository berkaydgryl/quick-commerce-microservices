package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// addressIDParam, adres yolundaki kimlik: /v1/me/addresses/{addressId} (T11.15).
const addressIDParam = "addressId"

// AddressUpdater, PUT /v1/me/addresses/{addressId} (adres duzenleme, T11.15).
type AddressUpdater interface {
	UpdateAddress(ctx context.Context, userID, addressID string, input auth.AddressInput) (auth.AddressBook, error)
}

// AddressDeleter, DELETE /v1/me/addresses/{addressId} (adres silme, T11.15).
type AddressDeleter interface {
	DeleteAddress(ctx context.Context, userID, addressID string) (auth.AddressBook, error)
}

// updateAddressHandler, PUT /v1/me/addresses/{addressId}: adresi TAM govdeyle
// degistirir (govde eklemeyle ayni: addressCreateBody). Cevap guncel defter.
// Bicimsiz ya da defterde olmayan kimlik NOT_FOUND (servis karar verir).
func updateAddressHandler(updater AddressUpdater) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		var body addressCreateBody
		if err := decodeJSONBody(c, &body); err != nil {
			return err
		}
		errs := fieldErrors{}
		idempotencyKeyOf(c, errs)
		input := body.toInput(errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		book, err := updater.UpdateAddress(c.Context(), userIDOf(c), addressIDOf(c), input)
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, book)
	}
}

// deleteAddressHandler, DELETE /v1/me/addresses/{addressId}: govdesizdir;
// cevap guncel defter. Silinmis adresi yeniden silmek NOT_FOUND'dur; ayni
// Idempotency-Key ile tekrar ise ilk cevabi alir (tekrar korumasi).
func deleteAddressHandler(deleter AddressDeleter) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		errs := fieldErrors{}
		idempotencyKeyOf(c, errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		book, err := deleter.DeleteAddress(c.Context(), userIDOf(c), addressIDOf(c))
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, book)
	}
}

// addressIDOf, yol parametresinin KOPYASI: Fiber parametreyi istegin
// tamponundan kopyalamadan verir (bekleyen is #87); bellek deposu kimligi
// saklar (favoriteMarketID ile ayni gerekce).
func addressIDOf(c fiber.Ctx) string {
	return strings.Clone(c.Params(addressIDParam))
}
