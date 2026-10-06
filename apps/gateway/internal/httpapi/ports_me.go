package httpapi

import (
	"context"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/emailverify"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/favorites"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/geo"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/phoneverify"
)

// ProfileGetter, GET /v1/me.
type ProfileGetter interface {
	Profile(ctx context.Context, userID string) (auth.Profile, error)
}

// AddressBookGetter, GET /v1/me/addresses (adres defteri, T9.5).
type AddressBookGetter interface {
	Addresses(ctx context.Context, userID string) (auth.AddressBook, error)
}

// AddressAdder, POST /v1/me/addresses (adres ekleme, T11.8).
type AddressAdder interface {
	AddAddress(ctx context.Context, userID string, input auth.AddressInput) (auth.AddressBook, error)
}

// EmailCodeSender, POST /v1/me/email/code (e-posta dogrulama kodu, T11.14).
type EmailCodeSender interface {
	SendCode(ctx context.Context, userID string, input emailverify.SendInput) (emailverify.Sent, error)
}

// EmailVerifier, POST /v1/me/email/verify (T11.14): guncel profili doner.
type EmailVerifier interface {
	Verify(ctx context.Context, userID string, input emailverify.VerifyInput) (auth.Profile, error)
}

// ProfileUpdater, PATCH /v1/me (ad degistirme, T11.14 PR 3; #89).
type ProfileUpdater interface {
	UpdateProfile(ctx context.Context, userID string, input auth.ProfileUpdateInput) (auth.Profile, error)
}

// PhoneCodeSender, POST /v1/me/phone/code (telefon dogrulama kodu, T11.14 PR 3).
type PhoneCodeSender interface {
	SendCode(ctx context.Context, userID string, input phoneverify.SendInput) (phoneverify.Sent, error)
}

// PhoneVerifier, POST /v1/me/phone/verify: kimlik (oturum) gerekir, numara
// degisince diger oturumlar kapanir.
type PhoneVerifier interface {
	Verify(ctx context.Context, identity auth.Identity, input phoneverify.VerifyInput) (auth.Profile, error)
}

// FavoriteLister, GET /v1/me/favorites (favori marketler, T11.13).
type FavoriteLister interface {
	Favorites(ctx context.Context, userID string) (favorites.List, error)
}

// FavoriteAdder, PUT /v1/me/favorites/{marketId} (T11.13).
type FavoriteAdder interface {
	AddFavorite(ctx context.Context, userID, marketID string) (favorites.Status, error)
}

// FavoriteRemover, DELETE /v1/me/favorites/{marketId} (T11.13).
type FavoriteRemover interface {
	RemoveFavorite(ctx context.Context, userID, marketID string) (favorites.Status, error)
}

// GeoReverser, GET /v1/geo/reverse (noktanin adres satiri, T11.8).
type GeoReverser interface {
	Reverse(ctx context.Context, lat, lng float64) (geo.ReverseResult, error)
}

// GeoSearcher, GET /v1/geo/search (adres aramasi, T11.8).
type GeoSearcher interface {
	Search(ctx context.Context, query string) (geo.SearchResult, error)
}
