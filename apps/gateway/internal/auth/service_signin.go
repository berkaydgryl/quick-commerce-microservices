package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// Register, yeni kullanici acar ve oturumunu baslatir. Girdi dogrulanmis gelir.
//
// Hesabin acildigi cihaz kaydedilir: "ayni cihazdan acilmis hesap sayisi"
// sinyali bununla sayilir. Ilk oturumun "onceki IP"si yoktur.
func (s *Service) Register(ctx context.Context, input RegisterInput, meta RequestMeta) (Grant, error) {
	hash, err := s.deps.Passwords.Hash(input.Password)
	if err != nil {
		return Grant{}, err
	}
	located := s.locate(meta.IPAddress)
	user := User{
		ID:                   ids.New(ids.User),
		Phone:                input.Phone,
		PasswordHash:         hash,
		FullName:             input.FullName,
		CreatedAt:            s.deps.Now().UTC(),
		RegistrationDeviceID: meta.DeviceID,
		LastLoginIP:          meta.IPAddress,
		LastLocation:         located.location(),
	}
	if err := s.deps.Users.Create(ctx, user); err != nil {
		if errors.Is(err, ErrPhoneTaken) {
			return Grant{}, apperror.New(apperror.CodePhoneAlreadyRegistered, map[string]string{FieldPhone: phoneTakenReason})
		}
		return Grant{}, fmt.Errorf("kullanici yazilamadi: %w", err)
	}
	return s.startSession(ctx, user, sessionStart{
		deviceID: meta.DeviceID, ipAddress: meta.IPAddress, ipCity: located.city(), location: located.location(),
	})
}

// PhoneRegistered, numarayla kayitli bir hesap olup olmadigini soyler (T11.7):
// karsilama ekraninin giris ve kayit penceresi numara yazilinca kullaniciyi
// erken uyarir. BILINCLI ODUNLESIM (2 Ekim karari): bu cevap bir numaranin
// kayitli olup olmadigini disari soyler; uc giris gibi IP basina hiz sinirina
// tabidir (httpapi/routes.go) ve numara gunluge yazilmaz.
func (s *Service) PhoneRegistered(ctx context.Context, input PhoneCheckInput) (bool, error) {
	_, err := s.deps.Users.ByPhone(ctx, input.Phone)
	if errors.Is(err, ErrUserNotFound) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("kullanici okunamadi: %w", err)
	}
	return true, nil
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
	return s.signIn(ctx, user, meta, apperror.New(apperror.CodeInvalidCredentials, nil))
}

// ResetPassword, telefonu kayitli hesabin sifresini degistirir, butun eski
// oturumlarini kapatir ve yeni oturum acar (T11.9; kullanici sifre degisince
// dogrudan girer).
//
// DEMO AKISI (2 Ekim karari): kimlik kanitlanmaz (SMS kodu yok); numarayi
// bilen sifreyi degistirebilir. Bu yuzden uc yalnizca production DISINDA
// baglanir (bootstrap, config.Config.DemoPasswordReset) ve giris gibi IP
// basina sinirlidir. Numaranin kayitli olmadigini soylemek yeni bir sizinti
// degildir (numara kontrolu, T11.7, ayni bilgiyi verir).
func (s *Service) ResetPassword(ctx context.Context, input ResetPasswordInput, meta RequestMeta) (Grant, error) {
	unknown := apperror.New(apperror.CodeValidationFailed, map[string]string{FieldPhone: phoneUnknownReason})
	user, err := s.deps.Users.ByPhone(ctx, input.Phone)
	if errors.Is(err, ErrUserNotFound) {
		return Grant{}, unknown
	}
	if err != nil {
		return Grant{}, fmt.Errorf("kullanici okunamadi: %w", err)
	}
	hash, err := s.deps.Passwords.Hash(input.Password)
	if err != nil {
		return Grant{}, err
	}
	err = s.deps.Users.SetPasswordHash(ctx, user.ID, hash)
	if errors.Is(err, ErrUserNotFound) {
		return Grant{}, unknown
	}
	if err != nil {
		return Grant{}, fmt.Errorf("sifre yazilamadi: %w", err)
	}
	// Eski sifreyle acilmis oturumlar (baska cihazlar) kapanir; yeni oturum sonra acilir.
	if _, err := s.deps.Sessions.RevokeAllForUser(ctx, user.ID); err != nil {
		return Grant{}, fmt.Errorf("eski oturumlar kapatilamadi: %w", err)
	}
	return s.signIn(ctx, user, meta, unknown)
}

// signIn, kimligi dogrulanmis kullanicinin girisini kaydeder ve oturum acar
// (giris ve sifre yenileme). Onceki IP oturuma "onceki IP" olarak yazilir;
// konum IP'den cozulemezse oturum kullanicinin son bilinen konumunu devralir.
// Kullanici bu arada silindiyse gone doner.
func (s *Service) signIn(ctx context.Context, user User, meta RequestMeta, gone error) (Grant, error) {
	located := s.locate(meta.IPAddress)
	previous, err := s.deps.Users.RecordLogin(ctx, user.ID, LoginState{IPAddress: meta.IPAddress, Location: located.location()})
	if errors.Is(err, ErrUserNotFound) {
		return Grant{}, gone
	}
	if err != nil {
		return Grant{}, fmt.Errorf("giris kaydedilemedi: %w", err)
	}
	location := located.location()
	if location == nil {
		location = previous.Location
	}
	return s.startSession(ctx, user, sessionStart{
		deviceID: meta.DeviceID, ipAddress: meta.IPAddress, previousIPAddress: previous.IPAddress,
		ipCity: located.city(), location: location,
	})
}

// located, IP'nin cozum sonucu; cozulemediyse bos.
type located struct {
	place Located
	found bool
}

func (s *Service) locate(ipAddress string) located {
	if s.deps.Locator == nil {
		return located{}
	}
	place, found := s.deps.Locator.Locate(ipAddress)
	return located{place: place, found: found}
}

// location, cozulen konum; cozulemediyse nil.
func (l located) location() *GeoPoint {
	if !l.found {
		return nil
	}
	point := l.place.Location
	return &point
}

// city, cozulen sehir; cozulemediyse bos.
func (l located) city() string {
	if !l.found {
		return ""
	}
	return l.place.City
}
