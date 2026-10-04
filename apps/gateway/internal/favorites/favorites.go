// Package favorites, kullanicinin favori marketleridir (T11.13; referans
// getircarsi "Favori Isletmelerim").
//
// Kayit gateway'in kullanici belgesindedir (adres defteri gibi; authstore);
// market bilgisi katalogdan TEK cagriyla gelir (BatchGetMarkets: favori
// basina GetMarket N+1 olurdu). Ekleme ve cikarma idempotenttir: ayni market
// iki kez eklenemez, olmayan favoriyi cikarmak hata degildir.
package favorites

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
)

// Sozlesme kurallari (@getir/contracts FAVORITE_MARKETS_MAX, CATALOG_ID_BODY_PATTERN,
// CATALOG_ID_MAX_LENGTH; esitligi contract_test.go denetler).
const (
	// MaxMarkets, kullanici basina en fazla favori market. Liste sinirlidir,
	// sayfalanmaz (proje kurallari, "Sinirli listeler istisnasi").
	MaxMarkets = 50
	// marketIDBodyPattern ve marketIDMaxLength, katalog kimliginin govdesi ve uzunlugu.
	marketIDBodyPattern = `[a-z0-9]+(?:-[a-z0-9]+)*`
	marketIDMaxLength   = 64
)

// Alan adlari ve sebepler istemciye gider (alanin altinda gosterilir): Turkce.
const (
	// FieldMarketID, yol parametresinin hatasi.
	FieldMarketID = "marketId"
	// FieldFavoriteMarkets, dolu listenin hatasi.
	FieldFavoriteMarkets = "favoriteMarkets"

	marketIDReason = "mkt_ önekli market kimliği olmalı"
)

var (
	marketIDRule   = regexp.MustCompile(`^mkt_` + marketIDBodyPattern + `$`)
	listFullReason = "en fazla " + strconv.Itoa(MaxMarkets) + " favori işletme olabilir"
)

// Catalog, favorilerin katalog tarafi (gercegi catalog.Service).
type Catalog interface {
	// Market, marketi okur; yoksa NOT_FOUND (eklemeden once varlik kontrolu).
	Market(ctx context.Context, marketID string) (catalog.Market, error)
	// MarketsByIDs, marketleri TEK cagrida okur; olmayan atlanir.
	MarketsByIDs(ctx context.Context, marketIDs []string) ([]catalog.Market, error)
}

// Item, favori listesinin satiri (@getir/contracts favoriteMarketSchema).
type Item struct {
	Market  catalog.Market `json:"market"`
	AddedAt time.Time      `json:"addedAt"`
}

// List, GET /v1/me/favorites cevabi (favoriteMarketListSchema). Bos liste
// JSON'da [] olur, null DEGIL.
type List struct {
	Items []Item `json:"items"`
}

// Status, ekleme ve cikarma cevabi (favoriteStatusSchema): marketin son durumu.
type Status struct {
	MarketID   string `json:"marketId"`
	IsFavorite bool   `json:"isFavorite"`
}

// Service, favori uclarinin is kurali.
type Service struct {
	store   Store
	catalog Catalog
	now     func() time.Time
}

// NewService, servisi kurar.
func NewService(store Store, catalog Catalog, now func() time.Time) *Service {
	return &Service{store: store, catalog: catalog, now: now}
}

// Favorites, oturumdaki kullanicinin favorileri, en yeni once. Katalogdan
// kaldirilmis market listede gorunmez (kayit durur; geri gelirse yine gorunur).
func (s *Service) Favorites(ctx context.Context, userID string) (List, error) {
	entries, err := s.store.List(ctx, userID)
	if err != nil {
		return List{}, mapStoreError(err, "favoriler okunamadi")
	}
	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		ids = append(ids, entry.MarketID)
	}
	markets, err := s.catalog.MarketsByIDs(ctx, ids)
	if err != nil {
		return List{}, err
	}
	byID := make(map[string]catalog.Market, len(markets))
	for _, market := range markets {
		byID[market.ID] = market
	}
	items := make([]Item, 0, len(entries))
	for _, entry := range entries {
		if market, found := byID[entry.MarketID]; found {
			items = append(items, Item{Market: market, AddedAt: entry.AddedAt})
		}
	}
	return List{Items: items}, nil
}

// AddFavorite, marketi favorilere ekler (idempotent). Market katalogda yoksa
// NOT_FOUND; liste doluysa VALIDATION_FAILED (favoriteMarkets).
func (s *Service) AddFavorite(ctx context.Context, userID, marketID string) (Status, error) {
	if err := checkMarketID(marketID); err != nil {
		return Status{}, err
	}
	if _, err := s.catalog.Market(ctx, marketID); err != nil {
		return Status{}, err
	}
	err := s.store.Add(ctx, userID, Entry{MarketID: marketID, AddedAt: s.now().UTC()}, MaxMarkets)
	if errors.Is(err, ErrListFull) {
		return Status{}, apperror.New(apperror.CodeValidationFailed, map[string]string{FieldFavoriteMarkets: listFullReason})
	}
	if err != nil {
		return Status{}, mapStoreError(err, "favori eklenemedi")
	}
	return Status{MarketID: marketID, IsFavorite: true}, nil
}

// RemoveFavorite, marketi favorilerden cikarir (idempotent: favori degilse de
// basarili). Katalog sorulmaz: kaldirilmis market de cikarilabilir.
func (s *Service) RemoveFavorite(ctx context.Context, userID, marketID string) (Status, error) {
	if err := checkMarketID(marketID); err != nil {
		return Status{}, err
	}
	if err := s.store.Remove(ctx, userID, marketID); err != nil {
		return Status{}, mapStoreError(err, "favori cikarilamadi")
	}
	return Status{MarketID: marketID, IsFavorite: false}, nil
}

// checkMarketID: sozlesmedeki katalog kimligi bicimi (marketIdSchema).
func checkMarketID(marketID string) error {
	if len(marketID) > marketIDMaxLength || !marketIDRule.MatchString(marketID) {
		return apperror.New(apperror.CodeValidationFailed, map[string]string{FieldMarketID: marketIDReason})
	}
	return nil
}

// mapStoreError: kullanici kaydi yoksa oturum gecersizdir (adres defteri gibi).
func mapStoreError(err error, action string) error {
	if errors.Is(err, ErrUserNotFound) {
		return apperror.New(apperror.CodeUnauthorized, nil)
	}
	return fmt.Errorf("%s: %w", action, err)
}
