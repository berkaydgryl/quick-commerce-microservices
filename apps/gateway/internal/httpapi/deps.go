package httpapi

import (
	"log/slog"

	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

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
	// ReservationReleaser, rezervasyonu birakma (T11.4); bugun order adaptoru.
	ReservationReleaser ReservationReleaser
	OrderPlacer         OrderPlacer
	ThreeDSConfirmer    ThreeDSConfirmer
	OrderGetter         OrderGetter
	OrderLister         OrderLister
	// OrderRoomTokens, siparis odasi jetonu (T12.2); bugun roomtoken.Service.
	OrderRoomTokens OrderRoomTokenIssuer
	// Kimlik uclari (T8.1); bugun hepsini auth.Service karsilar.
	UserRegistrar     UserRegistrar
	UserAuthenticator UserAuthenticator
	PhoneChecker      PhoneChecker
	// PasswordResetter, demo sifre yenileme (T11.9). nil ise uc HIC baglanmaz
	// (production: kimlik kanitlanmadan sifre degistirilemez).
	PasswordResetter PasswordResetter
	SessionRefresher SessionRefresher
	SessionRevoker   SessionRevoker
	ProfileGetter    ProfileGetter
	AddressBook      AddressBookGetter
	AddressAdder     AddressAdder
	AddressUpdater   AddressUpdater
	AddressDeleter   AddressDeleter
	// E-posta dogrulama (T11.14): tek emailverify servisi iki ucu karsilar.
	EmailCodeSender EmailCodeSender
	EmailVerifier   EmailVerifier
	// ProfileUpdater, ad degistirme (T11.14 PR 3); bugun auth.Service.
	ProfileUpdater ProfileUpdater
	// Telefon degistirme ve dogrulama (T11.14 PR 3). nil ise uclar HIC
	// baglanmaz (production: gercek SMS saglayicisi yok, bekleyen is #95).
	PhoneCodeSender PhoneCodeSender
	PhoneVerifier   PhoneVerifier
	// Favori marketler (T11.13): tek favori servisi uc ucu karsilar.
	Favorites       FavoriteLister
	FavoriteAdder   FavoriteAdder
	FavoriteRemover FavoriteRemover
	// Cards, kart kasasi uclari (T11.17, cards.go); bos ise uclar baglanmaz.
	Cards           CardRoutes
	CheckoutSignals CheckoutSignalReader
	// Harita adres uclari (T11.8); bugun ikisini geo.Service karsilar.
	GeoReverser GeoReverser
	GeoSearcher GeoSearcher
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
