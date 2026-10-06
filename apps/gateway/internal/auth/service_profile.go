package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// Profile, oturumdaki kullanicinin profili. Kullanici silinmisse jeton artik
// bir hesaba karsilik gelmez: UNAUTHORIZED.
func (s *Service) Profile(ctx context.Context, userID string) (Profile, error) {
	user, err := s.deps.Users.ByID(ctx, userID)
	if errors.Is(err, ErrUserNotFound) {
		return Profile{}, apperror.New(apperror.CodeUnauthorized, nil)
	}
	if err != nil {
		return Profile{}, fmt.Errorf("kullanici okunamadi: %w", err)
	}
	return user.Profile(), nil
}

// UpdateProfile, adi degistirir ve guncel profili doner (T11.14 PR 3; bekleyen
// is #89). Girdi dogrulanmis gelir (ProfileUpdateInput.Check). Kullanici
// silinmisse UNAUTHORIZED (Profile gibi).
func (s *Service) UpdateProfile(ctx context.Context, userID string, input ProfileUpdateInput) (Profile, error) {
	err := s.deps.Users.SetFullName(ctx, userID, input.FullName)
	if errors.Is(err, ErrUserNotFound) {
		return Profile{}, apperror.New(apperror.CodeUnauthorized, nil)
	}
	if err != nil {
		return Profile{}, fmt.Errorf("ad yazilamadi: %w", err)
	}
	return s.Profile(ctx, userID)
}
