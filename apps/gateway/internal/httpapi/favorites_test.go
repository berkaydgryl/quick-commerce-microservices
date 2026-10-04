package httpapi

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"golang.org/x/crypto/bcrypt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/favorites"
)

// Favori marketler (T11.13) gercek servislerle sinanir: kayit -> favori ->
// liste -> cikarma. Katalog taklittir (iki market).

type favoriteCatalog struct{}

var favoriteMarkets = map[string]catalog.Market{
	"mkt_sok-moda":    {ID: "mkt_sok-moda", Name: "ŞOK – Moda", Brand: "ŞOK"},
	"mkt_moda-kasabi": {ID: "mkt_moda-kasabi", Name: "Moda Kasabı", Brand: "Moda Kasabı"},
}

func (favoriteCatalog) Market(_ context.Context, marketID string) (catalog.Market, error) {
	market, found := favoriteMarkets[marketID]
	if !found {
		return catalog.Market{}, apperror.New(apperror.CodeNotFound, nil)
	}
	return market, nil
}

func (favoriteCatalog) MarketsByIDs(_ context.Context, marketIDs []string) ([]catalog.Market, error) {
	markets := []catalog.Market{}
	for _, id := range marketIDs {
		if market, found := favoriteMarkets[id]; found {
			markets = append(markets, market)
		}
	}
	return markets, nil
}

func favoritesApp(t *testing.T) *fiber.App {
	t.Helper()
	passwords, err := auth.NewPasswordHasher(bcrypt.MinCost)
	if err != nil {
		t.Fatalf("sifre ozetleyici kurulamadi: %v", err)
	}
	identity := auth.NewService(auth.Deps{
		Users: authstore.NewMemoryUsers(), Sessions: authstore.NewMemorySessions(), Passwords: passwords,
		Tokens: testTokens(), RefreshTTL: testRefresh, Now: time.Now,
	})
	service := favorites.NewService(authstore.NewMemoryFavorites(), favoriteCatalog{}, time.Now)
	return New(Deps{
		Health:          fakeReporter{report: healthyReport()},
		UserRegistrar:   identity,
		Favorites:       service,
		FavoriteAdder:   service,
		FavoriteRemover: service,
		AccessTokens:    testTokens(),
		Idempotency:     testIdempotency(),
		Logger:          silentLogger(),
	})
}

func favoriteRequest(t *testing.T, method, path, authorization, key string) *http.Request {
	t.Helper()
	headers := map[string]string{fiber.HeaderAuthorization: authorization}
	if key != "" {
		headers[IdempotencyKeyHeader] = key
	}
	return jsonRequest(t, method, path, "", headers)
}

func TestFavoritesFlow(t *testing.T) {
	app := favoritesApp(t)
	authorization := signedUp(t, app)

	status, header, envelope := exchange(t, app, favoriteRequest(t, http.MethodGet, "/v1/me/favorites", authorization, ""))
	if list := dataOf[favorites.List](t, envelope); status != http.StatusOK || len(list.Items) != 0 || header.Get(fiber.HeaderCacheControl) != noStore {
		t.Fatalf("bos liste, 200 ve no-store bekleniyordu: %d %+v", status, envelope)
	}

	for i, marketID := range []string{"mkt_sok-moda", "mkt_moda-kasabi"} {
		status, envelope = send(t, app, favoriteRequest(t, http.MethodPut, "/v1/me/favorites/"+marketID, authorization, "favori-000"+string(rune('1'+i))))
		if got := dataOf[favorites.Status](t, envelope); status != http.StatusOK || got != (favorites.Status{MarketID: marketID, IsFavorite: true}) {
			t.Fatalf("%s eklenmeli: %d %+v", marketID, status, envelope)
		}
	}
	status, envelope = send(t, app, favoriteRequest(t, http.MethodGet, "/v1/me/favorites", authorization, ""))
	list := dataOf[favorites.List](t, envelope)
	if status != http.StatusOK || len(list.Items) != 2 || list.Items[0].Market.ID != "mkt_moda-kasabi" || list.Items[0].AddedAt.IsZero() {
		t.Fatalf("en yeni once, market bilgisiyle: %d %+v", status, list)
	}

	status, envelope = send(t, app, favoriteRequest(t, http.MethodDelete, "/v1/me/favorites/mkt_moda-kasabi", authorization, "favori-0003"))
	if got := dataOf[favorites.Status](t, envelope); status != http.StatusOK || got.IsFavorite {
		t.Fatalf("cikarma basarili olmali: %d %+v", status, envelope)
	}
	// Favori olmayan marketi cikarmak da basarili (idempotent).
	if status, _ = send(t, app, favoriteRequest(t, http.MethodDelete, "/v1/me/favorites/mkt_moda-kasabi", authorization, "favori-0004")); status != http.StatusOK {
		t.Errorf("tekrar cikarma 200 olmali: %d", status)
	}
	status, envelope = send(t, app, favoriteRequest(t, http.MethodGet, "/v1/me/favorites", authorization, ""))
	if list := dataOf[favorites.List](t, envelope); len(list.Items) != 1 || list.Items[0].Market.ID != "mkt_sok-moda" {
		t.Errorf("cikarilan favori listede olmamali: %d %+v", status, list)
	}
}

func TestFavoriteMutationsNeedIdempotencyKey(t *testing.T) {
	app := favoritesApp(t)
	authorization := signedUp(t, app)
	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		status, envelope := send(t, app, favoriteRequest(t, method, "/v1/me/favorites/mkt_sok-moda", authorization, ""))
		if status != http.StatusBadRequest || detailsOf(t, envelope)[IdempotencyKeyHeader] != requiredReason {
			t.Errorf("%s anahtarsiz 400 ve Idempotency-Key ayrintisi donmeli: %d %+v", method, status, envelope)
		}
	}
}

func TestFavoriteErrors(t *testing.T) {
	app := favoritesApp(t)
	authorization := signedUp(t, app)

	status, envelope := send(t, app, favoriteRequest(t, http.MethodPut, "/v1/me/favorites/mkt_yok", authorization, "favori-0001"))
	if status != http.StatusNotFound || envelope.Error.Code != apperror.CodeNotFound {
		t.Errorf("olmayan market 404 olmali: %d %+v", status, envelope)
	}
	status, envelope = send(t, app, favoriteRequest(t, http.MethodPut, "/v1/me/favorites/sok-moda", authorization, "favori-0002"))
	if status != http.StatusBadRequest || detailsOf(t, envelope)[favorites.FieldMarketID] == nil {
		t.Errorf("bicimsiz kimlik 400 ve marketId ayrintisi donmeli: %d %+v", status, envelope)
	}
	// Kimliksiz istek: 401.
	if status, _ = send(t, app, favoriteRequest(t, http.MethodGet, "/v1/me/favorites", "", "")); status != http.StatusUnauthorized {
		t.Errorf("kimliksiz istek 401 olmali: %d", status)
	}
	// Bilinmeyen sorgu parametresi reddedilir.
	if status, _ = send(t, app, favoriteRequest(t, http.MethodGet, "/v1/me/favorites?sira=eski", authorization, "")); status != http.StatusBadRequest {
		t.Errorf("bilinmeyen parametre 400 olmali: %d", status)
	}
}
