package authstore

import (
	"context"
	"slices"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

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

// UpdateAddress, adresi tek kilit altinda degistirir; kurallar Mongo'dakiyle
// ayni (adres var, ayni ad baska adreste yok).
func (m *MemoryUsers) UpdateAddress(_ context.Context, userID string, address auth.SavedAddress) (auth.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	user, found := m.byID[userID]
	if !found {
		return auth.User{}, auth.ErrUserNotFound
	}
	index := slices.IndexFunc(user.Addresses, func(existing auth.SavedAddress) bool { return existing.ID == address.ID })
	if index < 0 {
		return auth.User{}, auth.ErrAddressNotFound
	}
	for _, existing := range user.Addresses {
		if existing.ID != address.ID && existing.Title == address.Title {
			return auth.User{}, auth.ErrAddressTitleTaken
		}
	}
	addresses := slices.Clone(user.Addresses)
	addresses[index] = address
	user.Addresses = addresses
	m.byID[userID] = user
	return user, nil
}

// DeleteAddress, adresi tek kilit altinda defterden cikarir.
func (m *MemoryUsers) DeleteAddress(_ context.Context, userID, addressID string) (auth.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	user, found := m.byID[userID]
	if !found {
		return auth.User{}, auth.ErrUserNotFound
	}
	index := slices.IndexFunc(user.Addresses, func(existing auth.SavedAddress) bool { return existing.ID == addressID })
	if index < 0 {
		return auth.User{}, auth.ErrAddressNotFound
	}
	user.Addresses = slices.Delete(slices.Clone(user.Addresses), index, index+1)
	m.byID[userID] = user
	return user, nil
}
