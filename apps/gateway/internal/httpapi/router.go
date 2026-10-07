package httpapi

// router.go YALNIZCA uygulamayi ve ara katmanlari kurar, rota gruplarini
// cagirir. Her parcanin kendi dosyasi var; bir sebeple degisen kod tek dosyada
// kalsin diye bolundu:
//   routes.go     - rota gruplari: katalog, kimlik, hesap, siparis (D18)
//   deps.go       - Deps: yonlendiricinin disaridan aldigi her sey (D18)
//   ports_*.go    - handler'larin tek davranisli arayuzleri, rota gruplarina gore (D18)
//   health.go     - /healthz
//   categories.go - /v1/categories
//   content.go    - /v1/content/welcome (karsilama ekrani icerigi, T11.6)
//   markets.go    - /v1/markets ve alt uclari (pazaryeri)
//   search.go     - /v1/search (genel arama, T9.6)
//   orders.go     - /v1/cart/reserve (T7.5, birakma T11.4) ve /v1/orders uclari (T7.5)
//   order_body.go - siparis uclarinin istek govdeleri ve bicim dogrulamasi
//   auth.go       - /v1/auth, GET /v1/me ve /v1/me/addresses okuma ve ekleme (T8.1, T9.5)
//   addresses.go  - PUT ve DELETE /v1/me/addresses/{addressId} (T11.15)
//   refresh_cookie.go - yenileme jetonu cerezi (ADR-12)
//   auth_body.go  - kimlik uclarinin istek govdeleri
//   favorites.go  - /v1/me/favorites uclari (favori marketler, T11.13)
//   email.go      - /v1/me/email uclari (e-posta dogrulama, T11.14)
//   email_body.go - e-posta uclarinin istek govdeleri
//   profile.go    - PATCH /v1/me ve /v1/me/phone uclari (profil duzenleme, T11.14 PR 3)
//   profile_body.go - profil duzenleme uclarinin istek govdeleri
//   geo.go        - /v1/geo/reverse ve /v1/geo/search (harita adres, T11.8)
//   cards.go      - /v1/me/cards uclari (kart kasasi, T11.17)
//   card_attempts.go - kart ekleme deneme siniri (T11.17, K2)
//   realtime.go   - GET /v1/orders/{id}/token (siparis odasi jetonu, T12.2)
//   tracking.go   - GET /v1/orders/{id}/tracking (kurye takibi, T14.2)
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
	"github.com/gofiber/fiber/v3"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace/noop"
)

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
	mw := routeMiddleware{
		generalByIP:   limits.limit(deps.RateLimit.General, byClientIP),
		authByIP:      limits.limit(deps.RateLimit.Auth, byClientIP),
		generalByUser: limits.limit(deps.RateLimit.General, byUser),
		// E-posta dogrulama (T11.14) kimlik uclari gibi siki: kod denemesi kaba
		// kuvvete, kod istegi baskasinin kutusuna ileti yagdirmaya karsi.
		authByUser:  limits.limit(deps.RateLimit.Auth, byUser),
		orderByUser: limits.limit(deps.RateLimit.Order, byUser),
		// Tekrar korumasi (T8.2) ROTA BASINA: yalnizca Idempotency-Key isteyen
		// mutasyon uclarinda. Korumali uclarda kimlikten SONRA: kayit kullanicinin
		// kapsamindadir (idem:{usr_...}:anahtar).
		register: idempotent(deps.Idempotency, registerPolicy, deps.Logger, recorder),
		mutation: idempotent(deps.Idempotency, mutationPolicy, deps.Logger, recorder),
		checkout: idempotent(deps.Idempotency, checkoutPolicy, deps.Logger, recorder),
		// Korumali uclar: once kimlik, sonra uc. Ara katman ROTA BASINA verilir;
		// /v1 grubuna Use ile verilseydi katalog ve giris uclari da kimlik isterdi.
		user:     requireUser(deps.AccessTokens),
		devices:  deviceCookies{secure: deps.SecureCookies},
		sessions: refreshCookies{secure: deps.SecureCookies},
	}

	v1 := app.Group("/v1")
	registerCatalogRoutes(v1, deps, mw)
	registerIdentityRoutes(v1, deps, mw)
	registerMeRoutes(v1, deps, mw, cardRouteDeps{user: mw.user, general: mw.generalByUser,
		idempotency: deps.Idempotency, limits: limits, logger: deps.Logger, recorder: recorder})
	registerOrderRoutes(v1, deps, mw)

	return app
}
