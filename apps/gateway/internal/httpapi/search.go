package httpapi

import (
	"net/http"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
)

// Genel arama ucu (T9.6, openapi: searchNearby): markete girmeden, konuma
// hizmet veren marketlerde urun ya da market adi. markets.go'daki uclarla ayni
// sira: bilinmeyen parametreyi reddet -> bicimi dogrula -> cagir -> zarfla.

// searchNearbyHandler, GET /v1/search?lat=&lng=&q=.
//
// q'nun KURALI (zorunlu, kirpilmis 2-64 karakter) catalog-service'tedir: bos ya
// da kisa arama oraya gider ve hatasi details.q ile doner. Burada yalnizca
// konumun bicimi dogrulanir; sayi olmayan konum servise tasinamaz.
func searchNearbyHandler(searcher NearbySearcher) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c, "lat", "lng", "q"); err != nil {
			return err
		}
		errs := fieldErrors{}
		query := catalog.SearchQuery{
			Lat:   requiredFloat(c, "lat", errs),
			Lng:   requiredFloat(c, "lng", errs),
			Query: c.Query("q"),
		}
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		list, err := searcher.Search(outgoingContext(c), query)
		if err != nil {
			return err
		}
		return ok(c, http.StatusOK, list)
	}
}
