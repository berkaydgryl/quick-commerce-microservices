package httpapi

// router.go YALNIZCA uygulamayi kurar ve rotalari baglar. Her parcanin
// kendi dosyasi var; bir sebeple degisen kod tek dosyada kalsin diye bolundu:
//   health.go     - /healthz
//   categories.go - /v1/categories
//   content.go    - /v1/content/welcome (karsilama ekrani icerigi, T11.6)
//   markets.go    - /v1/markets ve alt uclari (pazaryeri)
//   search.go     - /v1/search (genel arama, T9.6)
//   orders.go     - /v1/cart/reserve ve /v1/orders uclari (T7.5)
//   order_body.go - siparis uclarinin istek govdeleri ve bicim dogrulamasi
//   auth.go       - /v1/auth, /v1/me ve /v1/me/addresses uclari (T8.1, T9.5)
//   auth_body.go  - kimlik uclarinin istek govdeleri
//   identity.go   - kullanici kimligi (Bearer erisim jetonu, T8.1)
//   device.go     - cihaz cerezi (risk sinyali, T8.1)
//   idempotency.go- Idempotency-Key basligi ve tekrar korumasi (ADR-08, T8.2)
//   ratelimit.go  - hiz siniri (kayan pencere; T8.2, roadmap P2)
//   body.go       - JSON govdenin kati cozulmesi
//   params.go     - sorgu parametresinin tipine cevrilmesi
//   middleware.go - istek gunlugu
//   tracing.go    - istek span'i (D15; izin listeli nitelikler)
//   metrics.go    - istek metrikleri (#29; kapali etiket kumeleri)
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
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/content"
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

// WelcomeContentGetter, GET /v1/content/welcome (T11.6); gercegi content.Static.
type WelcomeContentGetter interface {
	Welcome(ctx context.Context) (content.Welcome, error)
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

// AddressBookGetter, GET /v1/me/addresses (adres defteri, T9.5).
type AddressBookGetter interface {
	Addresses(ctx context.Context, userID string) (auth.AddressBook, error)
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
	WelcomeContent   WelcomeContentGetter
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
	AddressBook       AddressBookGetter
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
	// Tracer ve Propagator, istek span'leri (D15). Verilmezse span acilmaz
	// (bos izleyici) ve W3C yayici kullanilir; testlerin cogu izsizdir.
	Tracer     trace.Tracer
	Propagator propagation.TextMapPropagator
	// Metrics, istek, tekrar korumasi ve hiz siniri metrikleri (#29). Verilmezse
	// yazilmaz.
	Metrics RequestMetrics
}

// New, Fiber uygulamasini kurar.
func New(deps Deps) *fiber.App {
	recorder := deps.Metrics
	if recorder == nil {
		recorder = noMetrics{}
	}
	app := fiber.New(fiber.Config{
		// Kendi zarfimizi yaziyoruz; Fiber'in varsayilan duz metin hatasi
		// sozlesmeyi bozardi.
		ErrorHandler: errorHandler(deps.Logger, recorder),
		// Sunucu adini disariya bildirmek gereksiz bilgi sizdirir.
		ServerHeader: "",
		JSONEncoder:  encodeJSON,
		// Siparis govdeleri kucuktur; sinirsiz govde bellege alinmasin (body.go).
		BodyLimit: maxBodyBytes,
	})

	// Sira onemli: kimlik -> iz -> metrik -> istek gunlugu -> panik kurtarma
	// (T8.3, D15, #29). Panik hataya gunlugun ICINDE doner; boylece istek
	// gunlugu de 500'u ve ayni requestId'yi yazar. Span kimlikten sonra acilir
	// (requestId niteligi); span ve metrik istek gunlugunu sarar: hatayi cevaba
	// gunluk cevirir, ikisi cevabin SON durum koduyla yazilir (disarida
	// kalsalar 200 kaydederlerdi).
	tracer, propagator := deps.Tracer, deps.Propagator
	if tracer == nil {
		tracer = noop.NewTracerProvider().Tracer("")
	}
	if propagator == nil {
		propagator = propagation.TraceContext{}
	}
	app.Use(requestIDMiddleware)
	app.Use(tracingMiddleware(tracer, propagator))
	app.Use(metricsMiddleware(recorder))
	app.Use(requestLogger(deps.Logger))
	app.Use(recoverPanics())

	app.Get(healthPath, healthzHandler(deps.Health))

	// Hiz siniri (T8.2) ROTA BASINA: kimliksiz uclarda IP, korumali uclarda
	// kimlikten SONRA kullanici sayilir. /healthz sinirsiz.
	limits := newRateLimiter(deps.RateLimit, deps.Logger, recorder)
	generalByIP := limits.limit(deps.RateLimit.General, byClientIP)
	authByIP := limits.limit(deps.RateLimit.Auth, byClientIP)
	generalByUser := limits.limit(deps.RateLimit.General, byUser)
	orderByUser := limits.limit(deps.RateLimit.Order, byUser)

	v1 := app.Group("/v1")
	v1.Get("/categories", generalByIP, listCategoriesHandler(deps.Categories))
	v1.Get("/content/welcome", generalByIP, welcomeContentHandler(deps.WelcomeContent))
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
	register := idempotent(deps.Idempotency, registerPolicy, deps.Logger, recorder)
	mutation := idempotent(deps.Idempotency, mutationPolicy, deps.Logger, recorder)
	checkout := idempotent(deps.Idempotency, checkoutPolicy, deps.Logger, recorder)
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
	v1.Get("/me/addresses", user, generalByUser, addressesHandler(deps.AddressBook))
	v1.Post("/cart/reserve", user, orderByUser, mutation, reserveCartHandler(deps.CartReserver))
	v1.Post("/orders", user, orderByUser, checkout, placeOrderHandler(deps.OrderPlacer, deps.CheckoutSignals))
	v1.Post("/orders/:"+orderIDParam+"/3ds", user, orderByUser, checkout, confirmThreeDSHandler(deps.ThreeDSConfirmer))
	v1.Get("/orders/:"+orderIDParam, user, generalByUser, getOrderHandler(deps.OrderGetter))

	return app
}
