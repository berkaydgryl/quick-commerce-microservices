// Package auth, kimlik use-case'leridir (T8.1): kayit, giris, yenileme, cikis
// ve profil. Kimlik telefon + sifre ile kurulur (ADR-12).
//
// HTTP'yi ve Mongo'yu BILMEZ: girdi dogrulanmis gelir (httpapi, rules.go),
// kayitlar depolardan okunur (authstore). Is sonuclari *apperror.Error olarak
// doner (INVALID_CREDENTIALS, PHONE_ALREADY_REGISTERED, UNAUTHORIZED); altyapi
// hatalari sarmalanip yukari tasinir ve hata isleyicide INTERNAL olur.
package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// Sebepler: istemcinin gordugu alan mesajlari.
const (
	phoneTakenReason     = "bu numarayla kayitli bir hesap var"
	refreshInvalidReason = "gecersiz, kullanilmis ya da suresi dolmus"
	fieldRefreshToken    = "refreshToken"
)

// Passwords, sifre ozetleme; gercegi PasswordHasher (bcrypt).
type Passwords interface {
	Hash(password string) (string, error)
	Matches(hash, password string) (bool, error)
	Burn(password string) bool
}

// TokenIssuer, erisim jetonu uretimi; gercegi Tokens (JWT).
type TokenIssuer interface {
	Issue(identity Identity) (string, error)
	TTL() time.Duration
}

// Deps, servisin disaridan aldigi her sey.
type Deps struct {
	Users     UserStore
	Sessions  SessionStore
	Passwords Passwords
	Tokens    TokenIssuer
	// RefreshTTL, yenileme jetonunun omru (REFRESH_TTL).
	RefreshTTL time.Duration
	// Now, saat; testte sabitlenir.
	Now func() time.Time
}

// Service, kimlik use-case'leri.
type Service struct {
	deps Deps
}

// NewService, bagimliliklarla kurar.
func NewService(deps Deps) *Service {
	return &Service{deps: deps}
}

// Register, yeni kullanici acar ve oturumunu baslatir. Girdi dogrulanmis gelir.
func (s *Service) Register(ctx context.Context, input RegisterInput, meta RequestMeta) (Grant, error) {
	hash, err := s.deps.Passwords.Hash(input.Password)
	if err != nil {
		return Grant{}, err
	}
	user := User{
		ID:           ids.New(ids.User),
		Phone:        input.Phone,
		PasswordHash: hash,
		FullName:     input.FullName,
		CreatedAt:    s.deps.Now().UTC(),
	}
	if err := s.deps.Users.Create(ctx, user); err != nil {
		if errors.Is(err, ErrPhoneTaken) {
			return Grant{}, apperror.New(apperror.CodePhoneAlreadyRegistered, map[string]string{FieldPhone: phoneTakenReason})
		}
		return Grant{}, fmt.Errorf("kullanici yazilamadi: %w", err)
	}
	return s.startSession(ctx, user, meta)
}

// Login, telefon ve sifreyle oturum acar.
//
// Hangi alanin hatali oldugu SOYLENMEZ ve olmayan kullanicida da ayni surede
// cevap verilir (Burn): kayitli numaralar ne mesajdan ne sureden taranabilir.
func (s *Service) Login(ctx context.Context, input LoginInput, meta RequestMeta) (Grant, error) {
	user, err := s.deps.Users.ByPhone(ctx, input.Phone)
	if errors.Is(err, ErrUserNotFound) {
		s.deps.Passwords.Burn(input.Password)
		return Grant{}, apperror.New(apperror.CodeInvalidCredentials, nil)
	}
	if err != nil {
		return Grant{}, fmt.Errorf("kullanici okunamadi: %w", err)
	}
	matches, err := s.deps.Passwords.Matches(user.PasswordHash, input.Password)
	if err != nil {
		return Grant{}, err
	}
	if !matches {
		return Grant{}, apperror.New(apperror.CodeInvalidCredentials, nil)
	}
	return s.startSession(ctx, user, meta)
}

// Refresh, yenileme jetonunu yenisiyle DEGISTIRIR ve yeni erisim jetonu verir.
// Eski jeton bir daha kullanilamaz: calinan jetonla ikinci yenileme reddedilir.
func (s *Service) Refresh(ctx context.Context, refreshToken string) (Grant, error) {
	now := s.deps.Now().UTC()
	next := newRefreshToken()
	session, err := s.deps.Sessions.Rotate(ctx, HashRefreshToken(refreshToken), HashRefreshToken(next), now, now.Add(s.deps.RefreshTTL))
	if errors.Is(err, ErrSessionNotFound) {
		return Grant{}, apperror.New(apperror.CodeUnauthorized, map[string]string{fieldRefreshToken: refreshInvalidReason})
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

func (s *Service) startSession(ctx context.Context, user User, meta RequestMeta) (Grant, error) {
	now := s.deps.Now().UTC()
	token := newRefreshToken()
	session := Session{
		ID:          ids.New(ids.Session),
		UserID:      user.ID,
		TokenHash:   HashRefreshToken(token),
		CreatedAt:   now,
		RefreshedAt: now,
		ExpiresAt:   now.Add(s.deps.RefreshTTL),
		IPAddress:   meta.IPAddress,
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
