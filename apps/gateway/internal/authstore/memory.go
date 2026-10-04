package authstore

import (
	"context"
	"slices"
	"sync"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/favorites"
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

// RecordLogin, girisi tek kilit altinda yazar ve onceki durumu doner.
func (m *MemoryUsers) RecordLogin(_ context.Context, userID string, login auth.LoginState) (auth.LoginState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	user, found := m.byID[userID]
	if !found {
		return auth.LoginState{}, auth.ErrUserNotFound
	}
	previous := auth.LoginState{IPAddress: user.LastLoginIP, Location: user.LastLocation}
	user.LastLoginIP = login.IPAddress
	if login.Location != nil {
		user.LastLocation = login.Location
	}
	m.byID[userID] = user
	return previous, nil
}

// AddAddress, adresi tek kilit altinda ekler; kurallar Mongo'dakiyle ayni
// (ayni ad yok, defter max'in altinda).
func (m *MemoryUsers) AddAddress(_ context.Context, userID string, address auth.SavedAddress, max int) (auth.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	user, found := m.byID[userID]
	if !found {
		return auth.User{}, auth.ErrUserNotFound
	}
	for _, existing := range user.Addresses {
		if existing.Title == address.Title {
			return auth.User{}, auth.ErrAddressTitleTaken
		}
	}
	if len(user.Addresses) >= max {
		return auth.User{}, auth.ErrAddressBookFull
	}
	// Yeni dilim: onceki okuyucularin elindeki User'in defteri degismez.
	user.Addresses = append(slices.Clone(user.Addresses), address)
	m.byID[userID] = user
	return user, nil
}

// CountByRegistrationDevice, cihazdan acilmis hesap sayisi.
func (m *MemoryUsers) CountByRegistrationDevice(_ context.Context, deviceID string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	count := 0
	for _, user := range m.byID {
		if user.RegistrationDeviceID == deviceID {
			count++
		}
	}
	return count, nil
}

// SetPasswordHash, sifre ozetini degistirir (T11.9).
func (m *MemoryUsers) SetPasswordHash(_ context.Context, userID, passwordHash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	user, found := m.byID[userID]
	if !found {
		return auth.ErrUserNotFound
	}
	user.PasswordHash = passwordHash
	m.byID[userID] = user
	return nil
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
