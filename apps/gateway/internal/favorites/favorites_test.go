package favorites_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/favorites"
)

const userID = "usr_0123456789abcdef0123456789abcdef"

// fakeCatalog, katalogu taklit eder ve toplu okuma cagrilarini sayar.
type fakeCatalog struct {
	markets    map[string]catalog.Market
	batchCalls [][]string
	err        error
}

func (f *fakeCatalog) Market(_ context.Context, marketID string) (catalog.Market, error) {
	market, found := f.markets[marketID]
	if !found {
		return catalog.Market{}, apperror.New(apperror.CodeNotFound, nil)
	}
	return market, nil
}

func (f *fakeCatalog) MarketsByIDs(_ context.Context, marketIDs []string) ([]catalog.Market, error) {
	f.batchCalls = append(f.batchCalls, marketIDs)
	if f.err != nil {
		return nil, f.err
	}
	found := []catalog.Market{}
	for _, id := range marketIDs {
		if market, ok := f.markets[id]; ok {
			found = append(found, market)
		}
	}
	return found, nil
}

func catalogWith(ids ...string) *fakeCatalog {
	markets := map[string]catalog.Market{}
	for _, id := range ids {
		markets[id] = catalog.Market{ID: id, Name: id}
	}
	return &fakeCatalog{markets: markets}
}

// clock, her cagrida bir saniye ilerler: eklenme sirasi belirlenebilir.
func clock() func() time.Time {
	now := time.Date(2026, 10, 4, 9, 0, 0, 0, time.UTC)
	return func() time.Time {
		now = now.Add(time.Second)
		return now
	}
}

func codeOf(err error) apperror.Code {
	var appErr *apperror.Error
	if errors.As(err, &appErr) {
		return appErr.Code
	}
	return ""
}

func TestFavoritesNewestFirstInOneCatalogCall(t *testing.T) {
	cat := catalogWith("mkt_a101-caferaga", "mkt_moda-kasabi", "mkt_sok-moda")
	service := favorites.NewService(authstore.NewMemoryFavorites(), cat, clock())
	for _, id := range []string{"mkt_a101-caferaga", "mkt_moda-kasabi", "mkt_sok-moda"} {
		if _, err := service.AddFavorite(t.Context(), userID, id); err != nil {
			t.Fatalf("%s eklenmeli: %v", id, err)
		}
	}
	// Katalogdan kaldirilan market listede gorunmez, kayit durur.
	delete(cat.markets, "mkt_moda-kasabi")

	list, err := service.Favorites(t.Context(), userID)
	if err != nil {
		t.Fatalf("liste hata dondu: %v", err)
	}
	got := []string{}
	for _, item := range list.Items {
		got = append(got, item.Market.ID)
	}
	if want := "mkt_sok-moda,mkt_a101-caferaga"; joinIDs(got) != want {
		t.Errorf("en yeni once, kaldirilan market yok: got %v want %s", got, want)
	}
	if len(cat.batchCalls) != 1 || len(cat.batchCalls[0]) != 3 {
		t.Errorf("TEK toplu katalog cagrisi bekleniyordu (N+1 yok): %v", cat.batchCalls)
	}
	if !list.Items[0].AddedAt.After(list.Items[1].AddedAt) {
		t.Errorf("eklenme zamani tasinmali: %+v", list.Items)
	}
}

func TestAddFavoriteIsIdempotentAndChecksTheCatalog(t *testing.T) {
	service := favorites.NewService(authstore.NewMemoryFavorites(), catalogWith("mkt_sok-moda"), clock())

	for range 2 {
		status, err := service.AddFavorite(t.Context(), userID, "mkt_sok-moda")
		if err != nil || status != (favorites.Status{MarketID: "mkt_sok-moda", IsFavorite: true}) {
			t.Fatalf("ekleme (tekrari dahil) basarili olmali: %+v %v", status, err)
		}
	}
	if list, err := service.Favorites(t.Context(), userID); err != nil || len(list.Items) != 1 {
		t.Errorf("ayni market bir kez listelenmeli: %+v %v", list.Items, err)
	}
	if _, err := service.AddFavorite(t.Context(), userID, "mkt_yok"); codeOf(err) != apperror.CodeNotFound {
		t.Errorf("katalogda olmayan market NOT_FOUND olmali: %v", err)
	}
}

func TestFavoriteMarketIDFormat(t *testing.T) {
	service := favorites.NewService(authstore.NewMemoryFavorites(), catalogWith(), clock())
	for _, id := range []string{"", "sok-moda", "mkt_", "mkt_Sok", "mkt_sok--moda", "prd_sut-1l", "mkt_" + string(make([]byte, 64))} {
		if _, err := service.AddFavorite(t.Context(), userID, id); codeOf(err) != apperror.CodeValidationFailed {
			t.Errorf("%q: ekleme VALIDATION_FAILED olmali: %v", id, err)
		}
		if _, err := service.RemoveFavorite(t.Context(), userID, id); codeOf(err) != apperror.CodeValidationFailed {
			t.Errorf("%q: cikarma VALIDATION_FAILED olmali: %v", id, err)
		}
	}
}

func TestRemoveFavoriteIsIdempotentWithoutCatalog(t *testing.T) {
	cat := catalogWith("mkt_sok-moda")
	service := favorites.NewService(authstore.NewMemoryFavorites(), cat, clock())
	if _, err := service.AddFavorite(t.Context(), userID, "mkt_sok-moda"); err != nil {
		t.Fatalf("ekleme: %v", err)
	}
	// Katalogdan kalkmis market de cikarilabilir: katalog sorulmaz.
	delete(cat.markets, "mkt_sok-moda")
	for range 2 {
		status, err := service.RemoveFavorite(t.Context(), userID, "mkt_sok-moda")
		if err != nil || status.IsFavorite {
			t.Fatalf("cikarma (tekrari dahil) basarili olmali: %+v %v", status, err)
		}
	}
}

func TestAddFavoriteOnFullListIsFieldError(t *testing.T) {
	ids := make([]string, 0, favorites.MaxMarkets+1)
	for i := range favorites.MaxMarkets + 1 {
		ids = append(ids, "mkt_m"+string(rune('a'+i/26))+string(rune('a'+i%26)))
	}
	service := favorites.NewService(authstore.NewMemoryFavorites(), catalogWith(ids...), clock())
	for _, id := range ids[:favorites.MaxMarkets] {
		if _, err := service.AddFavorite(t.Context(), userID, id); err != nil {
			t.Fatalf("%s eklenmeli: %v", id, err)
		}
	}

	_, err := service.AddFavorite(t.Context(), userID, ids[favorites.MaxMarkets])
	var appErr *apperror.Error
	if !errors.As(err, &appErr) || appErr.Code != apperror.CodeValidationFailed ||
		appErr.Details[favorites.FieldFavoriteMarkets] != "en fazla 50 favori işletme olabilir" {
		t.Errorf("dolu liste alan hatasi olmali: %v", err)
	}
}

// missingUserStore, silinmis hesabin eski jetonunu taklit eder.
type missingUserStore struct{}

func (missingUserStore) List(context.Context, string) ([]favorites.Entry, error) {
	return nil, favorites.ErrUserNotFound
}

func (missingUserStore) Add(context.Context, string, favorites.Entry, int) error {
	return favorites.ErrUserNotFound
}

func (missingUserStore) Remove(context.Context, string, string) error {
	return favorites.ErrUserNotFound
}

func TestMissingUserIsUnauthorized(t *testing.T) {
	service := favorites.NewService(missingUserStore{}, catalogWith("mkt_sok-moda"), clock())
	if _, err := service.Favorites(t.Context(), userID); codeOf(err) != apperror.CodeUnauthorized {
		t.Errorf("liste UNAUTHORIZED olmali: %v", err)
	}
	if _, err := service.AddFavorite(t.Context(), userID, "mkt_sok-moda"); codeOf(err) != apperror.CodeUnauthorized {
		t.Errorf("ekleme UNAUTHORIZED olmali: %v", err)
	}
	if _, err := service.RemoveFavorite(t.Context(), userID, "mkt_sok-moda"); codeOf(err) != apperror.CodeUnauthorized {
		t.Errorf("cikarma UNAUTHORIZED olmali: %v", err)
	}
}

func TestCatalogFailureSurfaces(t *testing.T) {
	cat := catalogWith()
	cat.err = apperror.New(apperror.CodeServiceUnavailable, nil)
	service := favorites.NewService(authstore.NewMemoryFavorites(), cat, clock())
	if _, err := service.Favorites(t.Context(), userID); codeOf(err) != apperror.CodeServiceUnavailable {
		t.Errorf("katalog hatasi oldugu gibi donmeli: %v", err)
	}
}

func joinIDs(ids []string) string {
	out := ""
	for i, id := range ids {
		if i > 0 {
			out += ","
		}
		out += id
	}
	return out
}
