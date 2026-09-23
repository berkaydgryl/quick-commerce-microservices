package httpapi

import (
	"net/http"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
)

// Pazaryeri uclari (ADR-15, openapi: listNearbyMarkets, getMarket,
// listMarketCategories, listMarketProducts). Her handler ayni sirayi kurar:
// bilinmeyen parametreyi reddet -> bicimi dogrula -> cagir -> zarfla.

const marketIDParam = "marketId"

// listNearbyMarketsHandler, GET /v1/markets?lat=&lng=.
func listNearbyMarketsHandler(lister NearbyMarketLister) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c, "lat", "lng"); err != nil {
			return err
		}
		errs := fieldErrors{}
		lat, lng := requiredFloat(c, "lat", errs), requiredFloat(c, "lng", errs)
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		list, err := lister.NearbyMarkets(outgoingContext(c), lat, lng)
		if err != nil {
			return err
		}
		return ok(c, http.StatusOK, list)
	}
}

// getMarketHandler, GET /v1/markets/{marketId}.
func getMarketHandler(getter MarketGetter) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		market, err := getter.Market(outgoingContext(c), c.Params(marketIDParam))
		if err != nil {
			return err
		}
		return ok(c, http.StatusOK, market)
	}
}

// listMarketCategoriesHandler, GET /v1/markets/{marketId}/categories.
func listMarketCategoriesHandler(lister MarketCategoryLister) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c); err != nil {
			return err
		}
		list, err := lister.MarketCategories(outgoingContext(c), c.Params(marketIDParam))
		if err != nil {
			return err
		}
		return ok(c, http.StatusOK, list)
	}
}

// listMarketProductsHandler, GET /v1/markets/{marketId}/products.
func listMarketProductsHandler(lister MarketProductLister) fiber.Handler {
	return func(c fiber.Ctx) error {
		if err := rejectUnknownQuery(c, "categoryId", "q", "pageToken", "pageSize"); err != nil {
			return err
		}
		errs := fieldErrors{}
		query := catalog.ProductQuery{
			MarketID:   c.Params(marketIDParam),
			CategoryID: c.Query("categoryId"),
			Query:      c.Query("q"),
			PageToken:  c.Query("pageToken"),
			PageSize:   optionalInt32(c, "pageSize", errs),
		}
		if len(errs) > 0 {
			return apperror.New(apperror.CodeValidationFailed, errs)
		}

		page, err := lister.MarketProducts(outgoingContext(c), query)
		if err != nil {
			return err
		}
		return ok(c, http.StatusOK, page)
	}
}
