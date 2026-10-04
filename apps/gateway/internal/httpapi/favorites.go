package httpapi

import (
	"net/http"
	"strings"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// Favori marketler (T11.13; openapi: listFavorites, addFavorite,
// removeFavorite). Kisisel veri: cevaplar onbelleklenmez. Ekleme ve cikarma
// kalici kayittir: Idempotency-Key ister (ADR-08); ikisi de dogasi geregi
// idempotenttir, anahtar ag tekrarinin ayni cevabi almasini saglar.

// favoritesHandler, GET /v1/me/favorites: en yeni favori once, marketler
// katalogdan tek cagriyla.
func favoritesHandler(lister FavoriteLister) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		list, err := lister.Favorites(outgoingContext(c), userIDOf(c))
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, list)
	}
}

// addFavoriteHandler, PUT /v1/me/favorites/{marketId}: market favori olur.
// Market yoksa 404; liste doluysa 400 (favoriteMarkets).
func addFavoriteHandler(adder FavoriteAdder) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := favoriteMutationCheck(c); err != nil {
			return err
		}
		status, err := adder.AddFavorite(outgoingContext(c), userIDOf(c), favoriteMarketID(c))
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, status)
	}
}

// removeFavoriteHandler, DELETE /v1/me/favorites/{marketId}: favori olmayan
// market de basarilidir (idempotent).
func removeFavoriteHandler(remover FavoriteRemover) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := favoriteMutationCheck(c); err != nil {
			return err
		}
		status, err := remover.RemoveFavorite(outgoingContext(c), userIDOf(c), favoriteMarketID(c))
		if err != nil {
			return err
		}
		return private(c, http.StatusOK, status)
	}
}

// favoriteMarketID, yol parametresinin KOPYASI. Fiber parametreyi istegin
// tamponundan kopyalamadan verir ve tampon sonraki isteklerde yeniden
// kullanilir; kimligi saklayan depo (MOCK'taki bellek) kopya olmadan bir sonraki
// istekte bozulmus kimlik okurdu (T11.13'te testle yakalandi).
func favoriteMarketID(c fiber.Ctx) string {
	return strings.Clone(c.Params(marketIDParam))
}

// favoriteMutationCheck: bilinmeyen sorgu parametresi ve eksik Idempotency-Key.
func favoriteMutationCheck(c fiber.Ctx) error {
	if err := rejectUnknownQuery(c); err != nil {
		return err
	}
	errs := fieldErrors{}
	idempotencyKeyOf(c, errs)
	if len(errs) > 0 {
		return apperror.New(apperror.CodeValidationFailed, errs)
	}
	return nil
}
