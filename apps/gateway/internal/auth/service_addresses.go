package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// AddAddress, adres defterine yeni adres ekler ve guncel defteri doner
// (T11.8: adresi olmayan kullanicinin adres ekleme penceresi). Girdi
// dogrulanmis gelir (AddressInput.Check). Ayni ad ve dolu defter alanin
// altinda gosterilen VALIDATION_FAILED'dir.
func (s *Service) AddAddress(ctx context.Context, userID string, input AddressInput) (AddressBook, error) {
	address := input.Address()
	address.ID = ids.New(ids.Address)
	user, err := s.deps.Users.AddAddress(ctx, userID, address, MaxSavedAddresses)
	if err != nil {
		return AddressBook{}, addressRejection(err, "adres eklenemedi")
	}
	return user.AddressBook(), nil
}

// UpdateAddress, kimligi verilen adresi girdiyle degistirir ve guncel defteri
// doner (T11.15; PUT /v1/me/addresses/{addressId}). Girdi dogrulanmis gelir.
// Kurallar eklemeyle ayni: ayni ad baska adreste olamaz (kendisi haric). Kimlik
// defterde yoksa (bicimsiz kimlik dahil) NOT_FOUND.
func (s *Service) UpdateAddress(ctx context.Context, userID, addressID string, input AddressInput) (AddressBook, error) {
	if !ids.Valid(ids.Address, addressID) {
		return AddressBook{}, addressNotFound()
	}
	address := input.Address()
	address.ID = addressID
	user, err := s.deps.Users.UpdateAddress(ctx, userID, address)
	if err != nil {
		return AddressBook{}, addressRejection(err, "adres guncellenemedi")
	}
	return user.AddressBook(), nil
}

// DeleteAddress, kimligi verilen adresi defterden cikarir ve guncel defteri
// doner (T11.15; DELETE /v1/me/addresses/{addressId}). Secili adresin silinmesi
// istemcinin isidir: secim bulunamayinca web defterin ilk adresini secer.
// Kimlik defterde yoksa NOT_FOUND.
func (s *Service) DeleteAddress(ctx context.Context, userID, addressID string) (AddressBook, error) {
	if !ids.Valid(ids.Address, addressID) {
		return AddressBook{}, addressNotFound()
	}
	user, err := s.deps.Users.DeleteAddress(ctx, userID, addressID)
	if err != nil {
		return AddressBook{}, addressRejection(err, "adres silinemedi")
	}
	return user.AddressBook(), nil
}

// addressRejection, deponun adres hatasini istemci hatasina cevirir: ayni ad
// ve dolu defter alanin altinda (VALIDATION_FAILED), yok olan adres NOT_FOUND,
// silinmis kullanici UNAUTHORIZED; gerisi sarmalanmis ic hata.
func addressRejection(err error, action string) error {
	switch {
	case errors.Is(err, ErrUserNotFound):
		return apperror.New(apperror.CodeUnauthorized, nil)
	case errors.Is(err, ErrAddressNotFound):
		return addressNotFound()
	case errors.Is(err, ErrAddressTitleTaken):
		return apperror.New(apperror.CodeValidationFailed, map[string]string{FieldTitle: addressTitleTakenReason})
	case errors.Is(err, ErrAddressBookFull):
		return apperror.New(apperror.CodeValidationFailed, map[string]string{FieldAddresses: addressBookFullReason})
	}
	return fmt.Errorf("%s: %w", action, err)
}

// addressNotFound, defterde olmayan adres: ayrintisiz NOT_FOUND (404).
func addressNotFound() error {
	return apperror.New(apperror.CodeNotFound, nil)
}

// Addresses, oturumdaki kullanicinin adres defteri (T9.5): web'in adres
// secimi buradan okur. Kullanici silinmisse UNAUTHORIZED (Profile gibi).
func (s *Service) Addresses(ctx context.Context, userID string) (AddressBook, error) {
	user, err := s.deps.Users.ByID(ctx, userID)
	if errors.Is(err, ErrUserNotFound) {
		return AddressBook{}, apperror.New(apperror.CodeUnauthorized, nil)
	}
	if err != nil {
		return AddressBook{}, fmt.Errorf("kullanici okunamadi: %w", err)
	}
	return user.AddressBook(), nil
}
