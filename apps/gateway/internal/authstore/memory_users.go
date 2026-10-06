package authstore

import (
	"context"
	"sync"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// MemoryUsers, bellek ici users.
type MemoryUsers struct {
	mu      sync.Mutex
	byID    map[string]auth.User
	byPhone map[string]string
	// byEmail, dogrulanmis e-posta -> kullanici (T11.14; Mongo'daki kismi
	// benzersiz indeksin karsiligi).
	byEmail map[string]string
}

// NewMemoryUsers, bos depo kurar.
func NewMemoryUsers() *MemoryUsers {
	return &MemoryUsers{byID: map[string]auth.User{}, byPhone: map[string]string{}, byEmail: map[string]string{}}
}

// Create, kullaniciyi yazar; telefon kayitliysa auth.ErrPhoneTaken.
func (m *MemoryUsers) Create(_ context.Context, user auth.User) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, taken := m.byPhone[user.Phone]; taken {
		return auth.ErrPhoneTaken
	}
	if user.Email != "" {
		if _, taken := m.byEmail[user.Email]; taken {
			return auth.ErrEmailTaken
		}
		m.byEmail[user.Email] = user.ID
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

// EmailOwner, adresi dogrulanmis kullanicinin kimligi; kimsede yoksa "" (T11.14).
func (m *MemoryUsers) EmailOwner(_ context.Context, email string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.byEmail[email], nil
}

// SetVerifiedEmail, dogrulanmis adresi tek kilit altinda yazar; kurallar
// Mongo'dakiyle ayni (adres baska hesaptaysa auth.ErrEmailTaken). Eski adres
// serbest kalir.
func (m *MemoryUsers) SetVerifiedEmail(_ context.Context, userID, email string, verifiedAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	user, found := m.byID[userID]
	if !found {
		return auth.ErrUserNotFound
	}
	if owner, taken := m.byEmail[email]; taken && owner != userID {
		return auth.ErrEmailTaken
	}
	delete(m.byEmail, user.Email)
	user.Email, user.EmailVerifiedAt = email, verifiedAt
	m.byID[userID] = user
	m.byEmail[email] = userID
	return nil
}

// SetFullName, adi degistirir (T11.14 PR 3, #89).
func (m *MemoryUsers) SetFullName(_ context.Context, userID, fullName string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	user, found := m.byID[userID]
	if !found {
		return auth.ErrUserNotFound
	}
	user.FullName = fullName
	m.byID[userID] = user
	return nil
}

// SetVerifiedPhone, dogrulanan numarayi tek kilit altinda yazar; kurallar
// Mongo'dakiyle ayni (numara baska hesaptaysa auth.ErrPhoneTaken). Eski numara
// serbest kalir.
func (m *MemoryUsers) SetVerifiedPhone(_ context.Context, userID, phone string, verifiedAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	user, found := m.byID[userID]
	if !found {
		return auth.ErrUserNotFound
	}
	if owner, taken := m.byPhone[phone]; taken && owner != userID {
		return auth.ErrPhoneTaken
	}
	delete(m.byPhone, user.Phone)
	user.Phone, user.PhoneVerifiedAt = phone, verifiedAt
	m.byID[userID] = user
	m.byPhone[phone] = userID
	return nil
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
