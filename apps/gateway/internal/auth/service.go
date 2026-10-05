// Package auth, kimlik use-case'leridir (T8.1): kayit, giris, yenileme, cikis,
// profil ve siparis anindaki oturum sinyalleri. Kimlik telefon + sifre ile
// kurulur (ADR-12).
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
	sessionEndedReason   = "oturum kapatilmis ya da suresi dolmus; yeniden giris yap"
	// fieldRefreshCookie, yenileme jetonunun cerezi: gecersiz jetonun hatasi
	// istemcinin gonderdigi seyin adiyla doner (httpapi RefreshCookie ile ayni).
	fieldRefreshCookie = "getir_refresh"
	// fieldAuthorization, erisim jetonunun basligi: oturumu biten jetonun
	// hatasi da bu adla doner (kimlik ara katmaniyla ayni).
	fieldAuthorization = "Authorization"
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
	// Locator, IP'yi oturum konumuna cevirir; yerelde NoLocator.
	Locator Locator
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
// tabidir (router.go) ve numara gunluge yazilmaz.
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
