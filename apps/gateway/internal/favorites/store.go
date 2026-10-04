package favorites

import (
	"context"
	"errors"
	"time"
)

var (
	// ErrListFull, kullanicinin favori listesi MaxMarkets'a ulasti.
	ErrListFull = errors.New("favori listesi dolu")
	// ErrUserNotFound, kullanici kaydi yok (silinmis hesabin eski jetonu).
	ErrUserNotFound = errors.New("kullanici bulunamadi")
)

// Entry, kayitli bir favori: market ve eklenme zamani.
type Entry struct {
	MarketID string
	AddedAt  time.Time
}

// Store, favorilerin kaydi (gercegi authstore: Mongo ve MOCK icin bellek).
type Store interface {
	// List, kullanicinin favorileri, EN YENI ONCE.
	List(ctx context.Context, userID string) ([]Entry, error)
	// Add, favoriyi ATOMIK ekler. Zaten favoriyse degistirmez, nil doner
	// (idempotent); liste max'ta ise ErrListFull.
	Add(ctx context.Context, userID string, entry Entry, max int) error
	// Remove, favoriyi cikarir; favori degilse de nil (idempotent).
	Remove(ctx context.Context, userID, marketID string) error
}
