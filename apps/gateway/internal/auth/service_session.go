package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// Refresh, yenileme jetonunu yenisiyle DEGISTIRIR ve yeni erisim jetonu verir.
// Eski jeton bir daha kullanilamaz: calinan jetonla ikinci yenileme reddedilir.
func (s *Service) Refresh(ctx context.Context, refreshToken string) (Grant, error) {
	now := s.deps.Now().UTC()
	next := newRefreshToken()
	session, err := s.deps.Sessions.Rotate(ctx, HashRefreshToken(refreshToken), HashRefreshToken(next), now, now.Add(s.deps.RefreshTTL))
	if errors.Is(err, ErrSessionNotFound) {
		return Grant{}, apperror.New(apperror.CodeUnauthorized, map[string]string{fieldRefreshCookie: refreshInvalidReason})
	}
	if err != nil {
		return Grant{}, fmt.Errorf("oturum yenilenemedi: %w", err)
	}
	user, err := s.deps.Users.ByID(ctx, session.UserID)
	if errors.Is(err, ErrUserNotFound) {
		return Grant{}, apperror.New(apperror.CodeUnauthorized, nil)
	}
	if err != nil {
		return Grant{}, fmt.Errorf("kullanici okunamadi: %w", err)
	}
	return s.grant(user, session.ID, next)
}

// Logout, yenileme jetonunu iptal eder. Jeton zaten yoksa false; hata degildir.
// Erisim jetonu kendi suresi (JWT_TTL) dolana kadar gecerli kalir: durumsuz
// jetonun bilinen bedeli; bu yuzden omru kisadir.
func (s *Service) Logout(ctx context.Context, refreshToken string) (bool, error) {
	revoked, err := s.deps.Sessions.Revoke(ctx, HashRefreshToken(refreshToken))
	if err != nil {
		return false, fmt.Errorf("oturum iptal edilemedi: %w", err)
	}
	return revoked, nil
}

// sessionStart, yeni oturumun sinyal alanlari.
type sessionStart struct {
	deviceID          string
	ipAddress         string
	previousIPAddress string
	ipCity            string
	location          *GeoPoint
}

func (s *Service) startSession(ctx context.Context, user User, start sessionStart) (Grant, error) {
	now := s.deps.Now().UTC()
	token := newRefreshToken()
	session := Session{
		ID:                ids.New(ids.Session),
		UserID:            user.ID,
		TokenHash:         HashRefreshToken(token),
		CreatedAt:         now,
		RefreshedAt:       now,
		ExpiresAt:         now.Add(s.deps.RefreshTTL),
		IPAddress:         start.ipAddress,
		DeviceID:          start.deviceID,
		PreviousIPAddress: start.previousIPAddress,
		IPCity:            start.ipCity,
		Location:          start.location,
	}
	if err := s.deps.Sessions.Create(ctx, session); err != nil {
		return Grant{}, fmt.Errorf("oturum yazilamadi: %w", err)
	}
	return s.grant(user, session.ID, token)
}

func (s *Service) grant(user User, sessionID, refreshToken string) (Grant, error) {
	access, err := s.deps.Tokens.Issue(Identity{UserID: user.ID, SessionID: sessionID})
	if err != nil {
		return Grant{}, err
	}
	return Grant{
		AccessToken:      access,
		TokenType:        tokenTypeBearer,
		ExpiresIn:        int64(s.deps.Tokens.TTL() / time.Second),
		RefreshToken:     refreshToken,
		RefreshExpiresIn: int64(s.deps.RefreshTTL / time.Second),
		User:             user.Profile(),
	}, nil
}
