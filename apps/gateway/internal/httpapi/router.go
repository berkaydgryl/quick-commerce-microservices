package httpapi

// router.go YALNIZCA uygulamayi kurar ve rotalari baglar. Her parcanin
// kendi dosyasi var; bir sebeple degisen kod tek dosyada kalsin diye bolundu:
//   health.go     - /healthz
//   categories.go - /v1/categories
//   markets.go    - /v1/markets ve alt uclari (pazaryeri)
//   params.go     - sorgu parametresinin tipine cevrilmesi
//   middleware.go - istek gunlugu
//   errors.go     - hata -> zarf cevirisi
//   requestid.go  - korelasyon kimligi (baslik, gRPC metadata'si)
//   query.go      - sorgu parametresi dogrulamasi
//   response.go   - cevap zarfi
//   json.go       - JSON kodlayici

import (
	"context"
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/health"
)

// HealthReporter, /healthz ucunun ihtiyaci olan tek davranis.
//
// Arayuz KULLANAN tarafta ve tek metotlu: testte sahte bir rapor dondurmek icin
// gercek gRPC istemcisi kurmak gerekmiyor.
type HealthReporter interface {
	Check(ctx context.Context) health.Report
}

// CategoryLister, GET /v1/categories ucunun ihtiyaci olan tek davranis.
type CategoryLister interface {
	ListCategories(ctx context.Context) (catalog.CategoryList, error)
}

// NearbyMarketLister, GET /v1/markets ucunun ihtiyaci olan tek davranis.
type NearbyMarketLister interface {
	NearbyMarkets(ctx context.Context, lat, lng float64) (catalog.NearbyMarketList, error)
}

// MarketGetter, GET /v1/markets/{marketId}.
type MarketGetter interface {
	Market(ctx context.Context, marketID string) (catalog.Market, error)
}

// MarketCategoryLister, GET /v1/markets/{marketId}/categories.
type MarketCategoryLister interface {
	MarketCategories(ctx context.Context, marketID string) (catalog.CategoryList, error)
}

// MarketProductLister, GET /v1/markets/{marketId}/products.
type MarketProductLister interface {
	MarketProducts(ctx context.Context, query catalog.ProductQuery) (catalog.ProductPage, error)
}

// Deps, yonlendiricinin disaridan aldigi her sey.
//
// Katalog uclari ayri alanlardir, tek buyuk arayuz degil: bugun hepsini ayni
// adaptor karsilasa da her handler yalnizca kendi ihtiyacini gorur ve testte
// yalnizca o davranis taklit edilir.
type Deps struct {
	Health           HealthReporter
	Categories       CategoryLister
	NearbyMarkets    NearbyMarketLister
	Market           MarketGetter
	MarketCategories MarketCategoryLister
	MarketProducts   MarketProductLister
	Logger           *slog.Logger
}

// New, Fiber uygulamasini kurar.
func New(deps Deps) *fiber.App {
	app := fiber.New(fiber.Config{
		// Kendi zarfimizi yaziyoruz; Fiber'in varsayilan duz metin hatasi
		// sozlesmeyi bozardi.
		ErrorHandler: errorHandler(deps.Logger),
		// Sunucu adini disariya bildirmek gereksiz bilgi sizdirir.
		ServerHeader: "",
		JSONEncoder:  encodeJSON,
	})

	app.Use(requestid.New(requestid.Config{Header: RequestIDHeader}))
	app.Use(requestLogger(deps.Logger))

	app.Get("/healthz", healthzHandler(deps.Health))

	v1 := app.Group("/v1")
	v1.Get("/categories", listCategoriesHandler(deps.Categories))
	v1.Get("/markets", listNearbyMarketsHandler(deps.NearbyMarkets))
	v1.Get("/markets/:marketId", getMarketHandler(deps.Market))
	v1.Get("/markets/:marketId/categories", listMarketCategoriesHandler(deps.MarketCategories))
	v1.Get("/markets/:marketId/products", listMarketProductsHandler(deps.MarketProducts))

	return app
}
