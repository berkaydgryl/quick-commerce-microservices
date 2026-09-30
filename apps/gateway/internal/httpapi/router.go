package httpapi

// router.go YALNIZCA uygulamayi kurar ve rotalari baglar. Her parcanin
// kendi dosyasi var; bir sebeple degisen kod tek dosyada kalsin diye bolundu:
//   health.go     - /healthz
//   categories.go - /v1/categories
//   markets.go    - /v1/markets ve alt uclari (pazaryeri)
//   search.go     - /v1/search (genel arama, T9.6)
//   orders.go     - /v1/cart/reserve ve /v1/orders uclari (T7.5)
//   order_body.go - siparis uclarinin istek govdeleri ve bicim dogrulamasi
//   auth.go       - /v1/auth ve /v1/me uclari (T8.1)
//   auth_body.go  - kimlik uclarinin istek govdeleri
//   identity.go   - kullanici kimligi (Bearer erisim jetonu, T8.1)
//   device.go     - cihaz cerezi (risk sinyali, T8.1)
//   idempotency.go- Idempotency-Key basligi ve tekrar korumasi (ADR-08, T8.2)
//   ratelimit.go  - hiz siniri (kayan pencere; T8.2, roadmap P2)
//   body.go       - JSON govdenin kati cozulmesi
//   params.go     - sorgu parametresinin tipine cevrilmesi
//   middleware.go - istek gunlugu
//   recover.go    - panik kurtarma (T8.3)
//   errors.go     - hata -> zarf cevirisi
//   requestid.go  - korelasyon kimligi (bicim, baslik, gRPC metadata'si)
//   query.go      - sorgu parametresi dogrulamasi
//   response.go   - cevap zarfi
//   json.go       - JSON kodlayici

import (
	"context"
	"log/slog"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/health"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
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

// NearbySearcher, GET /v1/search (genel arama, T9.6).
type NearbySearcher interface {
	Search(ctx context.Context, query catalog.SearchQuery) (catalog.SearchResultList, error)
}

// CartReserver, POST /v1/cart/reserve.
type CartReserver interface {
	Reserve(ctx context.Context, input order.ReserveInput) (order.Reservation, error)
}

// OrderPlacer, POST /v1/orders.
type OrderPlacer interface {
	Place(ctx context.Context, input order.PlaceInput) (order.Placement, error)
}

// ThreeDSConfirmer, POST /v1/orders/{id}/3ds.
type ThreeDSConfirmer interface {
	ConfirmThreeDS(ctx context.Context, input order.ConfirmInput) (order.Placement, error)
}

// OrderGetter, GET /v1/orders/{id}.
type OrderGetter interface {
	Get(ctx context.Context, userID, orderID string) (order.Order, error)
}

// UserRegistrar, POST /v1/auth/register.
type UserRegistrar interface {
	Register(ctx context.Context, input auth.RegisterInput, meta auth.RequestMeta) (auth.Grant, error)
}

// UserAuthenticator, POST /v1/auth/login.
type UserAuthenticator interface {
	Login(ctx context.Context, input auth.LoginInput, meta auth.RequestMeta) (auth.Grant, error)
}

// SessionRefresher, POST /v1/auth/refresh.
type SessionRefresher interface {
	Refresh(ctx context.Context, refreshToken string) (auth.Grant, error)
}

// SessionRevoker, POST /v1/auth/logout.
type SessionRevoker interface {
	Logout(ctx context.Context, refreshToken string) (bool, error)
}

// ProfileGetter, GET /v1/me.
type ProfileGetter interface {
	Profile(ctx context.Context, userID string) (auth.Profile, error)
}

// CheckoutSignalReader, POST /v1/orders'in risk sinyalleri (T8.1): oturum ve
// kullanici kaydindan; gercegi auth.Service.
type CheckoutSignalReader interface {
	CheckoutSignals(ctx context.Context, identity auth.Identity, ipAddress string) (auth.CheckoutSignals, error)
}

// AccessTokenVerifier, korumali uclarin erisim jetonunu dogrular (identity.go);
// gercegi auth.Tokens.
type AccessTokenVerifier interface {
	Verify(token string) (auth.Identity, error)
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
	NearbySearch     NearbySearcher
	CartReserver     CartReserver
	OrderPlacer      OrderPlacer
	ThreeDSConfirmer ThreeDSConfirmer
	OrderGetter      OrderGetter
	// Kimlik uclari (T8.1); bugun hepsini auth.Service karsilar.
	UserRegistrar     UserRegistrar
	UserAuthenticator UserAuthenticator
	SessionRefresher  SessionRefresher
	SessionRevoker    SessionRevoker
	ProfileGetter     ProfileGetter
	CheckoutSignals   CheckoutSignalReader
	// AccessTokens, korumali uclarin jeton dogrulayicisi.
	AccessTokens AccessTokenVerifier
	// Idempotency, mutasyon uclarinin tekrar korumasi (ADR-08, T8.2).
	Idempotency Idempotency
	// RateLimit, hiz siniri (T8.2, roadmap P2); Limiter nil ise kapali.
	RateLimit RateLimit
	// SecureCookies, cihaz cerezine Secure bayragi (yalnizca production:
	// gelistirme http://localhost uzerinden calisir).
	SecureCookies bool
	Logger        *slog.Logger
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
		// Siparis govdeleri kucuktur; sinirsiz govde bellege alinmasin (body.go).
		BodyLimit: maxBodyBytes,
	})

	// Sira onemli: kimlik -> istek gunlugu -> panik kurtarma (T8.3). Panik
	// hataya gunlugun ICINDE doner; boylece istek gunlugu de 500'u ve ayni
	// requestId'yi yazar.
	app.Use(requestIDMiddleware)
	app.Use(requestLogger(deps.Logger))
	app.Use(recoverPanics())

	app.Get("/healthz", healthzHandler(deps.Health))

	// Hiz siniri (T8.2) ROTA BASINA: kimliksiz uclarda IP, korumali uclarda
	// kimlikten SONRA kullanici sayilir. /healthz sinirsiz.
	limits := newRateLimiter(deps.RateLimit, deps.Logger)
	generalByIP := limits.limit(deps.RateLimit.General, byClientIP)
	authByIP := limits.limit(deps.RateLimit.Auth, byClientIP)
	generalByUser := limits.limit(deps.RateLimit.General, byUser)
	orderByUser := limits.limit(deps.RateLimit.Order, byUser)

	v1 := app.Group("/v1")
	v1.Get("/categories", generalByIP, listCategoriesHandler(deps.Categories))
	v1.Get("/markets", generalByIP, listNearbyMarketsHandler(deps.NearbyMarkets))
	v1.Get("/markets/:marketId", generalByIP, getMarketHandler(deps.Market))
	v1.Get("/markets/:marketId/categories", generalByIP, listMarketCategoriesHandler(deps.MarketCategories))
	v1.Get("/markets/:marketId/products", generalByIP, listMarketProductsHandler(deps.MarketProducts))
	v1.Get("/search", generalByIP, searchNearbyHandler(deps.NearbySearch))

	// Kimlik uclari (T8.1): kayit, giris, yenileme ve cikis kimliksizdir.
	devices := deviceCookies{secure: deps.SecureCookies}
	sessions := refreshCookies{secure: deps.SecureCookies}
	// Tekrar korumasi (T8.2) ROTA BASINA: yalnizca Idempotency-Key isteyen
	// mutasyon uclarinda. Korumali uclarda kimlikten SONRA: kayit kullanicinin
	// kapsamindadir (idem:{usr_...}:anahtar).
	register := idempotent(deps.Idempotency, registerPolicy, deps.Logger)
	mutation := idempotent(deps.Idempotency, mutationPolicy, deps.Logger)
	checkout := idempotent(deps.Idempotency, checkoutPolicy, deps.Logger)
	v1.Post("/auth/register", authByIP, register, registerHandler(deps.UserRegistrar, devices, sessions))
	v1.Post("/auth/login", authByIP, loginHandler(deps.UserAuthenticator, devices, sessions))
	// Yenileme ve cikis GENEL sinirda (T8.5): web her acilista sessizce yeniler;
	// jeton 256 bit rastgele oldugu icin kaba kuvvet siniri ona gerekmez.
	v1.Post("/auth/refresh", generalByIP, refreshHandler(deps.SessionRefresher, sessions))
	v1.Post("/auth/logout", generalByIP, logoutHandler(deps.SessionRevoker, sessions))

	// Korumali uclar: once kimlik, sonra uc. Ara katman ROTA BASINA verilir;
	// /v1 grubuna Use ile verilseydi katalog ve giris uclari da kimlik isterdi.
	user := requireUser(deps.AccessTokens)
	v1.Get("/me", user, generalByUser, meHandler(deps.ProfileGetter))
	v1.Post("/cart/reserve", user, orderByUser, mutation, reserveCartHandler(deps.CartReserver))
	v1.Post("/orders", user, orderByUser, checkout, placeOrderHandler(deps.OrderPlacer, deps.CheckoutSignals))
	v1.Post("/orders/:"+orderIDParam+"/3ds", user, orderByUser, checkout, confirmThreeDSHandler(deps.ThreeDSConfirmer))
	v1.Get("/orders/:"+orderIDParam, user, generalByUser, getOrderHandler(deps.OrderGetter))

	return app
}
