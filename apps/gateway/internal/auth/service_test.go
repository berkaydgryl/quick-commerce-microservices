package auth_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// Servis testleri bellek depolariyla kurulur (Mongo depolari ayni kurallari
// entegrasyon testinde gecer). Dis test paketi: authstore auth'u import eder,
// ic paketten import edilseydi dongu olurdu.

const (
	phone      = "+905321234567"
	password   = "Gizli-Parola-2026"
	fullName   = "Ayse Yilmaz"
	refreshTTL = 14 * 24 * time.Hour
	accessTTL  = time.Hour
)

var secret = []byte("yalnizca-test-icin-imza-sirri-32-bayttan-uzun")

// clock, testin ilerletebildigi saat.
type clock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// spyPasswords, gercek ozetleyiciyi sarar ve Burn cagrisini sayar.
type spyPasswords struct {
	*auth.PasswordHasher
	mu    sync.Mutex
	burns int
}

func (s *spyPasswords) Burn(password string) bool {
	s.mu.Lock()
	s.burns++
	s.mu.Unlock()
	return s.PasswordHasher.Burn(password)
}

type fixture struct {
	service   *auth.Service
	users     *authstore.MemoryUsers
	sessions  *authstore.MemorySessions
	passwords *spyPasswords
	tokens    *auth.Tokens
	clock     *clock
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	hasher, err := auth.NewPasswordHasher(bcrypt.MinCost)
	if err != nil {
		t.Fatalf("ozetleyici kurulamadi: %v", err)
	}
	f := &fixture{
		users:     authstore.NewMemoryUsers(),
		sessions:  authstore.NewMemorySessions(),
		passwords: &spyPasswords{PasswordHasher: hasher},
		clock:     &clock{now: time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)},
	}
	f.tokens = auth.NewTokens(secret, accessTTL, f.clock.Now)
	f.service = auth.NewService(auth.Deps{
		Users: f.users, Sessions: f.sessions, Passwords: f.passwords, Tokens: f.tokens,
		RefreshTTL: refreshTTL, Now: f.clock.Now,
	})
	return f
}

func (f *fixture) register(t *testing.T) auth.Grant {
	t.Helper()
	grant, err := f.service.Register(context.Background(), auth.RegisterInput{Phone: phone, Password: password, FullName: fullName}, auth.RequestMeta{IPAddress: "203.0.113.7"})
	if err != nil {
		t.Fatalf("kayit basarisiz: %v", err)
	}
	return grant
}

// codeOf, is hatasinin kodu; is hatasi degilse bos.
func codeOf(err error) apperror.Code {
	var appErr *apperror.Error
	if errors.As(err, &appErr) {
		return appErr.Code
	}
	return ""
}

func TestRegisterStoresOnlyHashesAndStartsSession(t *testing.T) {
	f := newFixture(t)

	grant := f.register(t)

	user, err := f.users.ByPhone(context.Background(), phone)
	if err != nil {
		t.Fatalf("kullanici yazilmadi: %v", err)
	}
	if user.PasswordHash == password || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		t.Errorf("sifre yalnizca bcrypt ozetiyle saklanmali: %q", user.PasswordHash)
	}
	if !ids.Valid(ids.User, user.ID) || grant.User != user.Profile() {
		t.Errorf("kimlik usr_ bicimli ve cevaptaki profille ayni olmali: %+v %+v", user, grant.User)
	}
	identity, err := f.tokens.Verify(grant.AccessToken)
	if err != nil || identity.UserID != user.ID || !ids.Valid(ids.Session, identity.SessionID) {
		t.Errorf("erisim jetonu kullanicinin oturumunu tasimali: %+v %v", identity, err)
	}
	if grant.ExpiresIn != int64(accessTTL/time.Second) || grant.RefreshExpiresIn != int64(refreshTTL/time.Second) {
		t.Errorf("omurler saniye olarak donmeli: %d %d", grant.ExpiresIn, grant.RefreshExpiresIn)
	}
	// Oturum jetonun kendisiyle degil ozetiyle bulunur; ham jetonla bulunamaz.
	if _, err := f.sessions.Rotate(context.Background(), grant.RefreshToken, "x", f.clock.Now(), f.clock.Now()); !errors.Is(err, auth.ErrSessionNotFound) {
		t.Errorf("oturum ham jetonla saklanmamali: %v", err)
	}
}

func TestRegisterMapsTakenPhone(t *testing.T) {
	f := newFixture(t)
	f.register(t)

	_, err := f.service.Register(context.Background(), auth.RegisterInput{Phone: phone, Password: "Baska-Parola-2026", FullName: "Baska"}, auth.RequestMeta{})

	var appErr *apperror.Error
	if !errors.As(err, &appErr) || appErr.Code != apperror.CodePhoneAlreadyRegistered || appErr.Details[auth.FieldPhone] == nil {
		t.Errorf("PHONE_ALREADY_REGISTERED ve phone ayrintisi bekleniyordu: %v", err)
	}
}

func TestLoginSucceedsWithRightPasswordOnly(t *testing.T) {
	f := newFixture(t)
	registered := f.register(t)

	grant, err := f.service.Login(context.Background(), auth.LoginInput{Phone: phone, Password: password}, auth.RequestMeta{})
	if err != nil || grant.User != registered.User || grant.RefreshToken == registered.RefreshToken {
		t.Fatalf("dogru sifreyle yeni oturum acilmali: %+v %v", grant, err)
	}

	_, err = f.service.Login(context.Background(), auth.LoginInput{Phone: phone, Password: "Yanlis-Parola-2026"}, auth.RequestMeta{})
	if codeOf(err) != apperror.CodeInvalidCredentials {
		t.Errorf("yanlis sifre INVALID_CREDENTIALS donmeli: %v", err)
	}
	if f.passwords.burns != 0 {
		t.Errorf("kayitli kullanicida zamanlama karsilastirmasi gerekmez: %d", f.passwords.burns)
	}
}

func TestLoginWithUnknownPhoneSpendsTheSameWork(t *testing.T) {
	// Kayitsiz numarada da bcrypt calismali: cevap suresi numaranin kayitli
	// olup olmadigini ele vermesin.
	f := newFixture(t)

	_, err := f.service.Login(context.Background(), auth.LoginInput{Phone: phone, Password: password}, auth.RequestMeta{})

	if codeOf(err) != apperror.CodeInvalidCredentials {
		t.Errorf("kayitsiz numara INVALID_CREDENTIALS donmeli: %v", err)
	}
	if f.passwords.burns != 1 {
		t.Errorf("zamanlama karsilastirmasi bir kez yapilmali: %d", f.passwords.burns)
	}
}

func TestRefreshRotatesAndKeepsSession(t *testing.T) {
	f := newFixture(t)
	registered := f.register(t)
	before, err := f.tokens.Verify(registered.AccessToken)
	if err != nil {
		t.Fatalf("jeton dogrulanamadi: %v", err)
	}
	f.clock.advance(10 * time.Minute)

	refreshed, err := f.service.Refresh(context.Background(), registered.RefreshToken)
	if err != nil {
		t.Fatalf("yenileme basarisiz: %v", err)
	}
	after, err := f.tokens.Verify(refreshed.AccessToken)

	if err != nil || after != before {
		t.Errorf("yenileme ayni oturumu surdurmeli: once %+v sonra %+v %v", before, after, err)
	}
	if refreshed.RefreshToken == registered.RefreshToken {
		t.Error("yenileme jetonu degismeliydi")
	}
	if _, err := f.service.Refresh(context.Background(), registered.RefreshToken); codeOf(err) != apperror.CodeUnauthorized {
		t.Errorf("kullanilmis jeton UNAUTHORIZED donmeli: %v", err)
	}
}

func TestRefreshExtendsLifetimeFromLastUse(t *testing.T) {
	// Kayan omur: her yenileme sureyi o andan itibaren REFRESH_TTL uzatir;
	// kullanilmayan oturum REFRESH_TTL sonunda kapanir.
	f := newFixture(t)
	token := f.register(t).RefreshToken

	f.clock.advance(refreshTTL - time.Minute)
	refreshed, err := f.service.Refresh(context.Background(), token)
	if err != nil {
		t.Fatalf("suresi dolmadan yenileme gecmeliydi: %v", err)
	}
	f.clock.advance(refreshTTL - time.Minute)
	if _, err := f.service.Refresh(context.Background(), refreshed.RefreshToken); err != nil {
		t.Errorf("son kullanimdan itibaren sure uzamaliydi: %v", err)
	}
}

func TestExpiredRefreshTokenIsRejected(t *testing.T) {
	f := newFixture(t)
	token := f.register(t).RefreshToken
	f.clock.advance(refreshTTL)

	if _, err := f.service.Refresh(context.Background(), token); codeOf(err) != apperror.CodeUnauthorized {
		t.Errorf("suresi dolan jeton UNAUTHORIZED donmeli: %v", err)
	}
}

func TestConcurrentRefreshWithSameTokenSucceedsOnce(t *testing.T) {
	// Calinan jetonla sahibi ayni anda yenilerse yalnizca biri kazanir.
	f := newFixture(t)
	token := f.register(t).RefreshToken
	const attempts = 16

	var wg sync.WaitGroup
	results := make(chan error, attempts)
	for range attempts {
		wg.Go(func() {
			_, err := f.service.Refresh(context.Background(), token)
			results <- err
		})
	}
	wg.Wait()
	close(results)

	succeeded := 0
	for err := range results {
		switch {
		case err == nil:
			succeeded++
		case codeOf(err) != apperror.CodeUnauthorized:
			t.Errorf("kaybeden UNAUTHORIZED almali: %v", err)
		}
	}
	if succeeded != 1 {
		t.Errorf("tam bir yenileme basarmali, %d basardi", succeeded)
	}
}

func TestRefreshForDeletedUserIsRejected(t *testing.T) {
	f := newFixture(t)
	token := "oturumu-olan-ama-kullanicisi-olmayan-jeton"
	now := f.clock.Now()
	if err := f.sessions.Create(context.Background(), auth.Session{
		ID: ids.New(ids.Session), UserID: ids.New(ids.User), TokenHash: auth.HashRefreshToken(token),
		CreatedAt: now, RefreshedAt: now, ExpiresAt: now.Add(refreshTTL),
	}); err != nil {
		t.Fatalf("oturum yazilamadi: %v", err)
	}

	if _, err := f.service.Refresh(context.Background(), token); codeOf(err) != apperror.CodeUnauthorized {
		t.Errorf("kullanicisi olmayan oturum UNAUTHORIZED donmeli: %v", err)
	}
}

func TestLogoutRevokesOnce(t *testing.T) {
	f := newFixture(t)
	token := f.register(t).RefreshToken

	first, err := f.service.Logout(context.Background(), token)
	if err != nil || !first {
		t.Fatalf("ilk cikis iptal etmeli: %v %v", first, err)
	}
	second, err := f.service.Logout(context.Background(), token)
	if err != nil || second {
		t.Errorf("ikinci cikis hatasiz false donmeli: %v %v", second, err)
	}
	if _, err := f.service.Refresh(context.Background(), token); codeOf(err) != apperror.CodeUnauthorized {
		t.Errorf("iptal edilen jeton yenilenmemeli: %v", err)
	}
}

func TestProfile(t *testing.T) {
	f := newFixture(t)
	registered := f.register(t)

	profile, err := f.service.Profile(context.Background(), registered.User.ID)
	if err != nil || profile != registered.User {
		t.Errorf("profil donmeli: %+v %v", profile, err)
	}
	if _, err := f.service.Profile(context.Background(), ids.New(ids.User)); codeOf(err) != apperror.CodeUnauthorized {
		t.Errorf("olmayan kullanici UNAUTHORIZED donmeli: %v", err)
	}
}

// failingUsers, altyapi hatasini taklit eder.
type failingUsers struct{ auth.UserStore }

func (failingUsers) Create(context.Context, auth.User) error { return errors.New("baglanti koptu") }

func TestInfrastructureErrorsAreNotBusinessErrors(t *testing.T) {
	// Depo hatasi is hatasina (ornek PHONE_ALREADY_REGISTERED) donusmemeli;
	// sarmalanip yukari gider ve hata isleyicide INTERNAL olur.
	f := newFixture(t)
	service := auth.NewService(auth.Deps{
		Users: failingUsers{}, Sessions: f.sessions, Passwords: f.passwords, Tokens: f.tokens,
		RefreshTTL: refreshTTL, Now: f.clock.Now,
	})

	_, err := service.Register(context.Background(), auth.RegisterInput{Phone: phone, Password: password, FullName: fullName}, auth.RequestMeta{})

	if err == nil || codeOf(err) != "" || !strings.Contains(err.Error(), "baglanti koptu") {
		t.Errorf("altyapi hatasi sarmalanmis olarak donmeli: %v", err)
	}
}

// fixedLocator, belirli IP'leri cozen sahte GeoIP.
type fixedLocator map[string]auth.Located

func (f fixedLocator) Locate(ip string) (auth.Located, bool) {
	located, found := f[ip]
	return located, found
}

func (f *fixture) registerFrom(t *testing.T, phone string, meta auth.RequestMeta) auth.Grant {
	t.Helper()
	grant, err := f.service.Register(context.Background(), auth.RegisterInput{Phone: phone, Password: password, FullName: fullName}, meta)
	if err != nil {
		t.Fatalf("kayit basarisiz: %v", err)
	}
	return grant
}

func (f *fixture) loginFrom(t *testing.T, phone string, meta auth.RequestMeta) auth.Grant {
	t.Helper()
	grant, err := f.service.Login(context.Background(), auth.LoginInput{Phone: phone, Password: password}, meta)
	if err != nil {
		t.Fatalf("giris basarisiz: %v", err)
	}
	return grant
}

func (f *fixture) signalsOf(t *testing.T, grant auth.Grant, ip string) (auth.CheckoutSignals, error) {
	t.Helper()
	identity, err := f.tokens.Verify(grant.AccessToken)
	if err != nil {
		t.Fatalf("jeton dogrulanamadi: %v", err)
	}
	return f.service.CheckoutSignals(context.Background(), identity, ip)
}

const deviceA = "dvc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func TestRegisterRecordsDeviceAndFirstSessionHasNoPreviousIP(t *testing.T) {
	f := newFixture(t)
	grant := f.registerFrom(t, phone, auth.RequestMeta{IPAddress: "85.105.1.1", DeviceID: deviceA})

	user, err := f.users.ByID(context.Background(), grant.User.ID)
	if err != nil || user.RegistrationDeviceID != deviceA || user.LastLoginIP != "85.105.1.1" {
		t.Errorf("kayit cihazi ve IP'yi yazmali: %+v %v", user, err)
	}
	signals, err := f.signalsOf(t, grant, "85.105.1.1")
	if err != nil {
		t.Fatalf("sinyaller okunamadi: %v", err)
	}
	if signals.DeviceID != deviceA || signals.PreviousIPAddress != "" || signals.AccountsOnDevice != 1 ||
		!signals.AccountCreatedAt.Equal(user.CreatedAt) || signals.SessionLocation != nil {
		t.Errorf("ilk oturum: cihaz, 1 hesap, hesap yasi; onceki IP ve konum yok: %+v", signals)
	}
}

func TestLoginCarriesPreviousLoginIP(t *testing.T) {
	f := newFixture(t)
	f.registerFrom(t, phone, auth.RequestMeta{IPAddress: "85.105.1.1", DeviceID: deviceA})
	f.loginFrom(t, phone, auth.RequestMeta{IPAddress: "85.105.1.2", DeviceID: deviceA})

	third := f.loginFrom(t, phone, auth.RequestMeta{IPAddress: "85.105.1.3", DeviceID: deviceA})

	signals, err := f.signalsOf(t, third, "85.105.1.3")
	if err != nil || signals.PreviousIPAddress != "85.105.1.2" || signals.IPAddress != "85.105.1.3" {
		t.Errorf("onceki IP bir onceki girisin IP'si olmali: %+v %v", signals, err)
	}
}

func TestSessionLocationFallsBackToLastKnown(t *testing.T) {
	// IP cozulebilirse konum oradan gelir ve kullanicinin son konumu olur;
	// cozulemezse (yerel ag, VPN) oturum son bilinen konumu devralir.
	f := newFixture(t)
	ankara := auth.GeoPoint{Lat: 39.93, Lng: 32.86}
	f.service = auth.NewService(auth.Deps{
		Users: f.users, Sessions: f.sessions, Passwords: f.passwords, Tokens: f.tokens,
		Locator:    fixedLocator{"85.105.1.1": {Location: ankara, City: "Ankara"}},
		RefreshTTL: refreshTTL, Now: f.clock.Now,
	})
	registered := f.registerFrom(t, phone, auth.RequestMeta{IPAddress: "85.105.1.1", DeviceID: deviceA})

	located, err := f.signalsOf(t, registered, "85.105.1.1")
	if err != nil || located.SessionLocation == nil || *located.SessionLocation != ankara || located.IPCity != "Ankara" {
		t.Fatalf("cozulen IP konum ve sehir vermeli: %+v %v", located, err)
	}

	unresolved := f.loginFrom(t, phone, auth.RequestMeta{IPAddress: "127.0.0.1", DeviceID: deviceA})
	inherited, err := f.signalsOf(t, unresolved, "127.0.0.1")
	if err != nil || inherited.SessionLocation == nil || *inherited.SessionLocation != ankara || inherited.IPCity != "" {
		t.Errorf("cozulemeyen IP'de konum son bilinenden, sehir bos gelmeli: %+v %v", inherited, err)
	}
}

func TestCheckoutSignalsRequireLiveSession(t *testing.T) {
	f := newFixture(t)
	grant := f.registerFrom(t, phone, auth.RequestMeta{IPAddress: "85.105.1.1", DeviceID: deviceA})
	identity, err := f.tokens.Verify(grant.AccessToken)
	if err != nil {
		t.Fatalf("jeton dogrulanamadi: %v", err)
	}

	other := identity
	other.UserID = ids.New(ids.User)
	if _, err := f.service.CheckoutSignals(context.Background(), other, "85.105.1.1"); codeOf(err) != apperror.CodeUnauthorized {
		t.Errorf("baska kullanicinin oturumu UNAUTHORIZED donmeli: %v", err)
	}

	f.clock.advance(refreshTTL)
	if _, err := f.service.CheckoutSignals(context.Background(), identity, "85.105.1.1"); codeOf(err) != apperror.CodeUnauthorized {
		t.Errorf("suresi dolan oturum UNAUTHORIZED donmeli: %v", err)
	}
}

func TestCheckoutSignalsAfterLogoutAreRefused(t *testing.T) {
	f := newFixture(t)
	grant := f.registerFrom(t, phone, auth.RequestMeta{IPAddress: "85.105.1.1", DeviceID: deviceA})
	if _, err := f.service.Logout(context.Background(), grant.RefreshToken); err != nil {
		t.Fatalf("cikis basarisiz: %v", err)
	}

	if _, err := f.signalsOf(t, grant, "85.105.1.1"); codeOf(err) != apperror.CodeUnauthorized {
		t.Errorf("kapatilan oturumla sinyal okunmamali: %v", err)
	}
}

func TestAccountsOnDeviceCountsRegistrationsNotLogins(t *testing.T) {
	// Sayim hesabin ACILDIGI cihaza gore: ayni tarayicidan baska hesaplara
	// girmek sayiyi artirmaz (aile cihazi, demo personalari); ayni cihazdan
	// acilan her hesap artirir (coklu hesap).
	f := newFixture(t)
	first := f.registerFrom(t, phone, auth.RequestMeta{IPAddress: "85.105.1.1", DeviceID: deviceA})
	f.registerFrom(t, "+905321230002", auth.RequestMeta{IPAddress: "85.105.1.1", DeviceID: "dvc_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"})
	secondOnA := f.loginFrom(t, "+905321230002", auth.RequestMeta{IPAddress: "85.105.1.1", DeviceID: deviceA})

	for name, tc := range map[string]struct {
		grant auth.Grant
		want  int
	}{
		"A'dan acilan hesap":             {grant: first, want: 1},
		"B'den acilip A'dan giren hesap": {grant: secondOnA, want: 1},
	} {
		signals, err := f.signalsOf(t, tc.grant, "85.105.1.1")
		if err != nil || signals.AccountsOnDevice != tc.want {
			t.Errorf("%s: %d hesap bekleniyordu: %+v %v", name, tc.want, signals, err)
		}
	}
}
