package httpapi

import (
	"net/http"

	"github.com/gofiber/fiber/v3"
)

// listCategoriesHandler, GET /v1/categories.
//
// Handler yalnizca sirayi kurar: dogrula -> cagir -> zarfla. gRPC ve proto
// catalog adaptorundedir, hata cevirisi errorHandler'dadir.
func listCategoriesHandler(lister CategoryLister) fiber.Handler {
	return func(c fiber.Ctx) error {
		// Sozlesmede bu ucun sorgu parametresi YOK (openapi: listCategories).
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}

		list, err := lister.ListCategories(outgoingContext(c))
		if err != nil {
			return err
		}
		return ok(c, http.StatusOK, list)
	}
}
