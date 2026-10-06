package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// CheckoutSignals, siparis veren oturumun risk sinyalleri (T8.1): cihaz, onceki
// IP ve konum oturumdan; hesap yasi ve cihazdan acilmis hesap sayisi kullanici
// kaydindan; IP istegin baglantisindan gelir.
//
// Oturum kapatilmis (cikis) ya da suresi dolmussa UNAUTHORIZED: erisim jetonu
// suresi dolana kadar gecerli olsa bile kapatilan oturumla siparis verilemez.
// Oturumu silmek risk sinyallerini silmenin yolu da olamaz.
func (s *Service) CheckoutSignals(ctx context.Context, identity Identity, ipAddress string) (CheckoutSignals, error) {
	ended := apperror.New(apperror.CodeUnauthorized, map[string]string{fieldAuthorization: sessionEndedReason})
	session, err := s.deps.Sessions.ByID(ctx, identity.SessionID)
	if errors.Is(err, ErrSessionNotFound) {
		return CheckoutSignals{}, ended
	}
	if err != nil {
		return CheckoutSignals{}, fmt.Errorf("oturum okunamadi: %w", err)
	}
	if session.UserID != identity.UserID || !session.ExpiresAt.After(s.deps.Now()) {
		return CheckoutSignals{}, ended
	}
	user, err := s.deps.Users.ByID(ctx, identity.UserID)
	if errors.Is(err, ErrUserNotFound) {
		return CheckoutSignals{}, ended
	}
	if err != nil {
		return CheckoutSignals{}, fmt.Errorf("kullanici okunamadi: %w", err)
	}
	accounts := 0
	if user.RegistrationDeviceID != "" {
		accounts, err = s.deps.Users.CountByRegistrationDevice(ctx, user.RegistrationDeviceID)
		if err != nil {
			return CheckoutSignals{}, fmt.Errorf("cihazdaki hesaplar sayilamadi: %w", err)
		}
	}
	return CheckoutSignals{
		IPAddress:         ipAddress,
		IPCity:            session.IPCity,
		DeviceID:          session.DeviceID,
		AccountsOnDevice:  accounts,
		PreviousIPAddress: session.PreviousIPAddress,
		SessionLocation:   session.Location,
		AccountCreatedAt:  user.CreatedAt,
	}, nil
}
