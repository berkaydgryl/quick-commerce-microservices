package authstore

import (
	"context"
	"slices"
	"sync"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/favorites"
)

// MemoryFavorites, bellek ici favori deposu (T11.13): MOCK ve testler icin.
// Kurallari MongoFavorites'takiyle AYNIDIR (en yeni basta, idempotent ekleme
// ve cikarma, sinir). Kullanici kaydini bilmez: her kimlik gecerli sayilir.
type MemoryFavorites struct {
	mu     sync.Mutex
	byUser map[string][]favorites.Entry
}

// NewMemoryFavorites, bos depo kurar.
func NewMemoryFavorites() *MemoryFavorites {
	return &MemoryFavorites{byUser: map[string][]favorites.Entry{}}
}

// List, kullanicinin favorileri, en yeni once (kopya).
func (m *MemoryFavorites) List(_ context.Context, userID string) ([]favorites.Entry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return slices.Clone(m.byUser[userID]), nil
}

// Add, favoriyi basa ekler; zaten favoriyse degistirmez, dolu listede ErrListFull.
func (m *MemoryFavorites) Add(_ context.Context, userID string, entry favorites.Entry, max int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	current := m.byUser[userID]
	if slices.ContainsFunc(current, func(existing favorites.Entry) bool { return existing.MarketID == entry.MarketID }) {
		return nil
	}
	if len(current) >= max {
		return favorites.ErrListFull
	}
	m.byUser[userID] = append([]favorites.Entry{entry}, current...)
	return nil
}

// Remove, favoriyi cikarir; favori degilse de basarilidir.
func (m *MemoryFavorites) Remove(_ context.Context, userID, marketID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.byUser[userID] = slices.DeleteFunc(slices.Clone(m.byUser[userID]), func(entry favorites.Entry) bool {
		return entry.MarketID == marketID
	})
	return nil
}
