package authstore

import (
	"context"
	"sync"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// Bellek ici depolar: MOCK=true'da Mongo olmadan calismak ve servis testleri
// icin. Kurallari Mongo'dakiyle AYNIDIR (telefon benzersiz, yenileme atomik,
// suresi dolan oturum yenilenmez); sureci kapaninca icerik kaybolur.

// MemoryUsers, bellek ici users.
type MemoryUsers struct {
	mu      sync.Mutex
	byID    map[string]auth.User
	byPhone map[string]string
}

// NewMemoryUsers, bos depo kurar.
func NewMemoryUsers() *MemoryUsers {
	return &MemoryUsers{byID: map[string]auth.User{}, byPhone: map[string]string{}}
}

// Create, kullaniciyi yazar; telefon kayitliysa auth.ErrPhoneTaken.
func (m *MemoryUsers) Create(_ context.Context, user auth.User) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, taken := m.byPhone[user.Phone]; taken {
		return auth.ErrPhoneTaken
	}
	m.byID[user.ID] = user
	m.byPhone[user.Phone] = user.ID
	return nil
}

// ByPhone, telefona gore kullanici.
func (m *MemoryUsers) ByPhone(_ context.Context, phone string) (auth.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, found := m.byPhone[phone]
	if !found {
		return auth.User{}, auth.ErrUserNotFound
	}
	return m.byID[id], nil
}

// ByID, kimlige gore kullanici.
func (m *MemoryUsers) ByID(_ context.Context, id string) (auth.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	user, found := m.byID[id]
	if !found {
		return auth.User{}, auth.ErrUserNotFound
	}
	return user, nil
}

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
