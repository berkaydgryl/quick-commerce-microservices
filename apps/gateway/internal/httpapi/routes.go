package httpapi

import "github.com/gofiber/fiber/v3"

// Rota gruplari (D18): New ara katmanlari bir kez kurar, gruplar uclari baglar.
// Gruplar New'daki kayit sirasini korur: rota tablosu (app.GetRoutes) ayni kalir.

// routeMiddleware, rota gruplarinin paylastigi ara katmanlar ve cerezler (New kurar).
type routeMiddleware struct {
	// Hiz siniri (T8.2): kimliksiz uclarda IP, korumali uclarda kullanici basina.
	generalByIP, authByIP     fiber.Handler
	generalByUser, authByUser fiber.Handler
	orderByUser               fiber.Handler
	// Tekrar korumasi (T8.2) politikalari: kayit, mutasyon, odeme.
	register, mutation, checkout fiber.Handler
	// user, korumali uclarin kimligi (Bearer erisim jetonu).
	user     fiber.Handler
	devices  deviceCookies
	sessions refreshCookies
}

// registerCatalogRoutes, kimliksiz katalog uclari: kategori, karsilama icerigi, market, arama.
func registerCatalogRoutes(v1 fiber.Router, deps Deps, mw routeMiddleware) {
	v1.Get("/categories", mw.generalByIP, listCategoriesHandler(deps.Categories))
	v1.Get("/content/welcome", mw.generalByIP, welcomeContentHandler(deps.WelcomeContent))
	v1.Get("/markets", mw.generalByIP, listNearbyMarketsHandler(deps.NearbyMarkets))
	v1.Get("/markets/:marketId", mw.generalByIP, getMarketHandler(deps.Market))
	v1.Get("/markets/:marketId/categories", mw.generalByIP, listMarketCategoriesHandler(deps.MarketCategories))
	v1.Get("/markets/:marketId/products", mw.generalByIP, listMarketProductsHandler(deps.MarketProducts))
	v1.Get("/search", mw.generalByIP, searchNearbyHandler(deps.NearbySearch))
}

// registerIdentityRoutes, kimlik uclari (T8.1): kayit, giris, yenileme ve cikis kimliksizdir.
func registerIdentityRoutes(v1 fiber.Router, deps Deps, mw routeMiddleware) {
	v1.Post("/auth/register", mw.authByIP, mw.register, registerHandler(deps.UserRegistrar, mw.devices, mw.sessions))
	v1.Post("/auth/login", mw.authByIP, loginHandler(deps.UserAuthenticator, mw.devices, mw.sessions))
	// Numara kontrolu (T11.7) giris gibi IP basina sinirli: kayitli numaralari
	// toplu taramayi yavaslatir. Sayac rota basinadir, girisin hakkini yemez.
	v1.Post("/auth/phone-check", mw.authByIP, phoneCheckHandler(deps.PhoneChecker))
	// Demo sifre yenileme (T11.9): yalnizca verildiyse; giris gibi IP basina sinirli.
	if deps.PasswordResetter != nil {
		v1.Post("/auth/password-reset", mw.authByIP, resetPasswordHandler(deps.PasswordResetter, mw.devices, mw.sessions))
	}
	// Yenileme ve cikis GENEL sinirda (T8.5): web her acilista sessizce yeniler;
	// jeton 256 bit rastgele oldugu icin kaba kuvvet siniri ona gerekmez.
	v1.Post("/auth/refresh", mw.generalByIP, refreshHandler(deps.SessionRefresher, mw.sessions))
	v1.Post("/auth/logout", mw.generalByIP, logoutHandler(deps.SessionRevoker, mw.sessions))
}

// registerMeRoutes, hesap uclari (kimlik gerekir): profil, adresler, e-posta,
// telefon, favoriler, kartlar ve harita adres uclari.
func registerMeRoutes(v1 fiber.Router, deps Deps, mw routeMiddleware, cardDeps cardRouteDeps) {
	v1.Get("/me", mw.user, mw.generalByUser, meHandler(deps.ProfileGetter))
	v1.Patch("/me", mw.user, mw.generalByUser, mw.mutation, updateProfileHandler(deps.ProfileUpdater))
	v1.Get("/me/addresses", mw.user, mw.generalByUser, addressesHandler(deps.AddressBook))
	v1.Post("/me/addresses", mw.user, mw.generalByUser, mw.mutation, addAddressHandler(deps.AddressAdder))
	v1.Put("/me/addresses/:"+addressIDParam, mw.user, mw.generalByUser, mw.mutation, updateAddressHandler(deps.AddressUpdater))
	v1.Delete("/me/addresses/:"+addressIDParam, mw.user, mw.generalByUser, mw.mutation, deleteAddressHandler(deps.AddressDeleter))
	v1.Post("/me/email/code", mw.user, mw.authByUser, mw.mutation, sendEmailCodeHandler(deps.EmailCodeSender))
	v1.Post("/me/email/verify", mw.user, mw.authByUser, mw.mutation, verifyEmailHandler(deps.EmailVerifier))
	if deps.PhoneCodeSender != nil && deps.PhoneVerifier != nil {
		v1.Post("/me/phone/code", mw.user, mw.authByUser, mw.mutation, sendPhoneCodeHandler(deps.PhoneCodeSender))
		v1.Post("/me/phone/verify", mw.user, mw.authByUser, mw.mutation, verifyPhoneHandler(deps.PhoneVerifier))
	}
	v1.Get("/me/favorites", mw.user, mw.generalByUser, favoritesHandler(deps.Favorites))
	v1.Put("/me/favorites/:"+marketIDParam, mw.user, mw.generalByUser, mw.mutation, addFavoriteHandler(deps.FavoriteAdder))
	v1.Delete("/me/favorites/:"+marketIDParam, mw.user, mw.generalByUser, mw.mutation, removeFavoriteHandler(deps.FavoriteRemover))
	registerCardRoutes(v1, deps.Cards, cardDeps)
	v1.Get("/geo/reverse", mw.user, mw.generalByUser, reverseGeocodeHandler(deps.GeoReverser))
	v1.Get("/geo/search", mw.user, mw.generalByUser, searchPlacesHandler(deps.GeoSearcher))
}

// registerOrderRoutes, sepet ve siparis uclari (kimlik gerekir).
func registerOrderRoutes(v1 fiber.Router, deps Deps, mw routeMiddleware) {
	v1.Post("/cart/reserve", mw.user, mw.orderByUser, mw.mutation, reserveCartHandler(deps.CartReserver))
	v1.Delete("/cart/reserve/:"+reservationIDParam, mw.user, mw.orderByUser, mw.mutation, releaseReservationHandler(deps.ReservationReleaser))
	v1.Post("/orders", mw.user, mw.orderByUser, mw.checkout, placeOrderHandler(deps.OrderPlacer, deps.CheckoutSignals))
	v1.Post("/orders/:"+orderIDParam+"/3ds", mw.user, mw.orderByUser, mw.checkout, confirmThreeDSHandler(deps.ThreeDSConfirmer))
	v1.Get("/orders", mw.user, mw.generalByUser, listOrdersHandler(deps.OrderLister))
	v1.Get("/orders/:"+orderIDParam, mw.user, mw.generalByUser, getOrderHandler(deps.OrderGetter))
	v1.Get("/orders/:"+orderIDParam+"/token", mw.user, mw.generalByUser, orderRoomTokenHandler(deps.OrderRoomTokens))
	// Konum kisisel veri: hata cevaplari dahil onbelleklenmez (#179 N3).
	v1.Get("/orders/:"+orderIDParam+"/tracking", noStoreRoute, mw.user, mw.generalByUser, orderTrackingHandler(deps.OrderTracking))
}
