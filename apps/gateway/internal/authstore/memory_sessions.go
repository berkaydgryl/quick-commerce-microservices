package authstore

import (
	"context"
	"sync"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// MemorySessions, bellek ici sessions.
type MemorySessions struct {
	mu     sync.Mutex
	byHash map[string]auth.Session
}

// NewMemorySessions, bos depo kurar.
func NewMemorySessions() *MemorySessions {
	return &MemorySessions{byHash: map[string]auth.Session{}}
}

// Create, oturumu yazar.
func (m *MemorySessions) Create(_ context.Context, session auth.Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.byHash[session.TokenHash] = session
	return nil
}

// Rotate, jetonu tek kilit altinda degistirir (Mongo'daki atomik guncellemenin karsiligi).
func (m *MemorySessions) Rotate(_ context.Context, oldHash, newHash string, now, expiresAt time.Time) (auth.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, found := m.byHash[oldHash]
	if !found || !session.ExpiresAt.After(now) {
		return auth.Session{}, auth.ErrSessionNotFound
	}
	delete(m.byHash, oldHash)
	session.TokenHash, session.RefreshedAt, session.ExpiresAt = newHash, now, expiresAt
	m.byHash[newHash] = session
	return session, nil
}

// Revoke, oturumu siler; silindiyse true.
func (m *MemorySessions) Revoke(_ context.Context, tokenHash string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, found := m.byHash[tokenHash]
	delete(m.byHash, tokenHash)
	return found, nil
}

// RevokeAllForUser, kullanicinin butun oturumlarini siler (T11.9).
func (m *MemorySessions) RevokeAllForUser(_ context.Context, userID string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	revoked := 0
	for hash, session := range m.byHash {
		if session.UserID == userID {
			delete(m.byHash, hash)
			revoked++
		}
	}
	return revoked, nil
}

// RevokeOthers, keepSessionID disindaki oturumlari siler (T11.14 PR 3).
func (m *MemorySessions) RevokeOthers(_ context.Context, userID, keepSessionID string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	revoked := 0
	for hash, session := range m.byHash {
		if session.UserID == userID && session.ID != keepSessionID {
			delete(m.byHash, hash)
			revoked++
		}
	}
	return revoked, nil
}

// ByID, kimlige gore oturum. Oturum sayisi kucuk (bellek yalnizca MOCK ve
// test icindir); dogrusal arama yeterli.
func (m *MemorySessions) ByID(_ context.Context, id string) (auth.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, session := range m.byHash {
		if session.ID == id {
			return session, nil
		}
	}
	return auth.Session{}, auth.ErrSessionNotFound
}
