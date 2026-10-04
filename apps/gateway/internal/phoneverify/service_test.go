package phoneverify

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/verification"
)

const (
	testCode     = "042137"
	testPassword = "Demo-Sifre-2026"
	oldPhone     = "+905321234567"
	newPhone     = "+905559876543"
)

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// recordingSMS, mesajlari tutar; fail doluysa gondermez.
type recordingSMS struct {
	mu   sync.Mutex
	sent []string
	to   []string
	fail error
}

func (r *recordingSMS) Send(_ context.Context, phone, text string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail != nil {
		return r.fail
	}
	r.to, r.sent = append(r.to, phone), append(r.sent, text)
	return nil
}

type fixture struct {
	service  *Service
	deps     Deps
	users    *authstore.MemoryUsers
	sessions *authstore.MemorySessions
	sms      *recordingSMS
	clock    *fakeClock
	identity auth.Identity
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	passwords, err := auth.NewPasswordHasher(bcrypt.MinCost)
	if err != nil {
		t.Fatalf("sifre ozetleyici: %v", err)
	}
	hash, err := passwords.Hash(testPassword)
	if err != nil {
		t.Fatalf("sifre ozeti: %v", err)
	}
	users, sessions := authstore.NewMemoryUsers(), authstore.NewMemorySessions()
	userID := ids.New(ids.User)
	if err := users.Create(t.Context(), auth.User{ID: userID, Phone: oldPhone, PasswordHash: hash, FullName: "Ayşe Yılmaz"}); err != nil {
		t.Fatalf("kullanici: %v", err)
	}
	current, other := ids.New(ids.Session), ids.New(ids.Session)
	for _, session := range []auth.Session{
		{ID: current, UserID: userID, TokenHash: "ozet-bu", ExpiresAt: time.Now().Add(time.Hour)},
		{ID: other, UserID: userID, TokenHash: "ozet-diger", ExpiresAt: time.Now().Add(time.Hour)},
	} {
		if err := sessions.Create(t.Context(), session); err != nil {
			t.Fatalf("oturum: %v", err)
		}
	}
	clock := &fakeClock{now: time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)}
	f := &fixture{users: users, sessions: sessions, sms: &recordingSMS{}, clock: clock, identity: auth.Identity{UserID: userID, SessionID: current}}
	f.deps = Deps{
		Accounts: users, Sessions: sessions, Passwords: passwords, Store: verification.NewMemory(clock.Now),
		SMS: f.sms, CodeKey: []byte("test-anahtari"), Now: clock.Now, NewCode: func() string { return testCode },
	}
	f.service = NewService(f.deps)
	return f
}

func (f *fixture) send(t *testing.T, phone, password string) (Sent, error) {
	t.Helper()
	input := SendInput{Phone: phone, Password: password}
	if problems := input.Check(); len(problems) > 0 {
		t.Fatalf("gecerli girdi bekleniyordu: %v", problems)
	}
	return f.service.SendCode(t.Context(), f.identity.UserID, input)
}

func (f *fixture) verify(t *testing.T, phone, code string) (auth.Profile, error) {
	t.Helper()
	return f.service.Verify(t.Context(), f.identity, VerifyInput{Phone: phone, Code: code})
}

func expectField(t *testing.T, err error, code apperror.Code, field, reason string) {
	t.Helper()
	appErr := testkit.AppErrorOf(t, err)
	if appErr.Code != code || appErr.Details[field] != reason {
		t.Fatalf("%s %s=%q bekleniyordu: %+v", code, field, reason, appErr)
	}
}

func TestChangeNumberSendsSMSAndRevokesOtherSessions(t *testing.T) {
	f := newFixture(t)

	sent, err := f.send(t, newPhone, testPassword)
	if err != nil {
		t.Fatalf("kod gonderilemedi: %v", err)
	}
	if sent != (Sent{Phone: newPhone, ExpiresInSeconds: 600, ResendAfterSeconds: 60}) {
		t.Errorf("cevap: %+v", sent)
	}
	if len(f.sms.to) != 1 || f.sms.to[0] != newPhone || !strings.Contains(f.sms.sent[0], testCode) {
		t.Fatalf("SMS yeni numaraya kodla gitmeli: %v %v", f.sms.to, f.sms.sent)
	}

	profile, err := f.verify(t, newPhone, testCode)
	if err != nil {
		t.Fatalf("dogrulanamadi: %v", err)
	}
	if profile.Phone != newPhone || !profile.PhoneVerified {
		t.Errorf("profil yeni ve dogrulanmis numarayi tasimali: %+v", profile)
	}
	if _, err := f.sessions.ByID(t.Context(), f.identity.SessionID); err != nil {
		t.Errorf("bu oturum surmeli: %v", err)
	}
	if _, err := f.users.ByPhone(t.Context(), oldPhone); !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("eski numara serbest kalmali: %v", err)
	}
	if n, err := f.sessions.RevokeOthers(t.Context(), f.identity.UserID, f.identity.SessionID); err != nil || n != 0 {
		t.Errorf("diger oturum zaten kapanmis olmali, %d kaldi", n)
	}
}

func TestChangeNumberNeedsTheRightPassword(t *testing.T) {
	f := newFixture(t)

	_, err := f.send(t, newPhone, "")
	expectField(t, err, apperror.CodeValidationFailed, FieldPassword, passwordRequiredReason)
	_, err = f.send(t, newPhone, "Yanlis-Sifre-2026")
	expectField(t, err, apperror.CodeValidationFailed, FieldPassword, passwordWrongReason)

	if len(f.sms.to) != 0 {
		t.Error("sifre dogru degilken SMS gitmemeli")
	}
}

func TestResendToPendingNumberNeedsNoPassword(t *testing.T) {
	// Karar (a), T11.14 PR 3: sifre o numaraya ilk kod istenirken soruldu; kayit
	// yasadikca "Kodu yeniden gönder" sifresizdir. 60 sn bekleme aynen gecerli.
	f := newFixture(t)
	if _, err := f.send(t, newPhone, testPassword); err != nil {
		t.Fatalf("ilk kod: %v", err)
	}

	_, err := f.send(t, newPhone, "")
	if code := testkit.AppErrorOf(t, err).Code; code != apperror.CodeRateLimited {
		t.Fatalf("sifresiz yeniden gonderim de 60 sn bekler (429): %v", code)
	}
	f.clock.Advance(verification.ResendAfter)
	if _, err := f.send(t, newPhone, ""); err != nil {
		t.Fatalf("bekleyen numaraya yeniden gonderim sifresiz olmali: %v", err)
	}
	if len(f.sms.to) != 2 || f.sms.to[1] != newPhone {
		t.Fatalf("ikinci SMS ayni numaraya gitmeli: %v", f.sms.to)
	}

	_, err = f.send(t, "+905551112233", "")
	expectField(t, err, apperror.CodeValidationFailed, FieldPassword, passwordRequiredReason)
	_, err = f.send(t, newPhone, "Yanlis-Sifre-2026")
	expectField(t, err, apperror.CodeValidationFailed, FieldPassword, passwordWrongReason)

	f.clock.Advance(verification.CodeTTL)
	_, err = f.send(t, newPhone, "")
	expectField(t, err, apperror.CodeValidationFailed, FieldPassword, passwordRequiredReason)
	if len(f.sms.to) != 2 {
		t.Errorf("reddedilen isteklerde SMS gitmemeli: %v", f.sms.to)
	}
}

func TestResendStillChecksTheNumberOwner(t *testing.T) {
	f := newFixture(t)
	if _, err := f.send(t, newPhone, testPassword); err != nil {
		t.Fatalf("ilk kod: %v", err)
	}
	if err := f.users.Create(t.Context(), auth.User{ID: ids.New(ids.User), Phone: newPhone, FullName: "Mehmet"}); err != nil {
		t.Fatalf("ikinci kullanici: %v", err)
	}
	f.clock.Advance(verification.ResendAfter)

	_, err := f.send(t, newPhone, "")

	expectField(t, err, apperror.CodePhoneAlreadyRegistered, FieldPhone, phoneTakenReason)
}

// brokenAddressStore, bekleyen adresi okuyamayan depo.
type brokenAddressStore struct{ verification.Store }

func (brokenAddressStore) PendingAddress(context.Context, string) (string, error) {
	return "", errors.New("redis kapali")
}

func TestResendWithUnreachableStoreIsUnavailable(t *testing.T) {
	f := newFixture(t)
	deps := f.deps
	deps.Store = brokenAddressStore{Store: deps.Store}
	f.service = NewService(deps)

	_, err := f.send(t, newPhone, "")

	if code := testkit.AppErrorOf(t, err).Code; code != apperror.CodeServiceUnavailable {
		t.Errorf("depo okunamazsa 503: %v", code)
	}
}

func TestChangeToTakenNumberIsPhoneAlreadyRegistered(t *testing.T) {
	f := newFixture(t)
	if err := f.users.Create(t.Context(), auth.User{ID: ids.New(ids.User), Phone: newPhone, FullName: "Mehmet"}); err != nil {
		t.Fatalf("ikinci kullanici: %v", err)
	}

	_, err := f.send(t, newPhone, testPassword)

	expectField(t, err, apperror.CodePhoneAlreadyRegistered, FieldPhone, phoneTakenReason)
	if apperror.HTTPStatus(apperror.CodePhoneAlreadyRegistered) != http.StatusConflict {
		t.Error("PHONE_ALREADY_REGISTERED 409 olmali")
	}
}

func TestVerifyLosesRaceForTheNumber(t *testing.T) {
	f := newFixture(t)
	if _, err := f.send(t, newPhone, testPassword); err != nil {
		t.Fatalf("kod: %v", err)
	}
	if err := f.users.Create(t.Context(), auth.User{ID: ids.New(ids.User), Phone: newPhone, FullName: "Mehmet"}); err != nil {
		t.Fatalf("ikinci kullanici: %v", err)
	}

	_, err := f.verify(t, newPhone, testCode)

	expectField(t, err, apperror.CodePhoneAlreadyRegistered, FieldPhone, phoneTakenReason)
	if _, err := f.sessions.ByID(t.Context(), f.identity.SessionID); err != nil {
		t.Errorf("basarisiz dogrulama oturumlara dokunmamali: %v", err)
	}
}

func TestVerifyCurrentNumberNeedsNoPasswordAndKeepsSessions(t *testing.T) {
	f := newFixture(t)

	if _, err := f.send(t, oldPhone, ""); err != nil {
		t.Fatalf("simdiki numara sifresiz dogrulanabilmeli: %v", err)
	}
	profile, err := f.verify(t, oldPhone, testCode)
	if err != nil || profile.Phone != oldPhone || !profile.PhoneVerified {
		t.Fatalf("dogrulanmis simdiki numara: %+v (%v)", profile, err)
	}
	if n, err := f.sessions.RevokeOthers(t.Context(), f.identity.UserID, f.identity.SessionID); err != nil || n != 1 {
		t.Errorf("numara degismedi, diger oturum kapanmamali: %d", n)
	}

	f.clock.Advance(verification.ResendAfter)
	_, err = f.send(t, oldPhone, "")
	expectField(t, err, apperror.CodeValidationFailed, FieldPhone, phoneCurrentReason)
}

func TestSendTooSoonAndSMSFailure(t *testing.T) {
	f := newFixture(t)
	f.sms.fail = errors.New("smtp kapali")

	_, err := f.send(t, newPhone, testPassword)
	if code := testkit.AppErrorOf(t, err).Code; code != apperror.CodeServiceUnavailable {
		t.Fatalf("SMS gidemezse 503: %v", code)
	}
	f.sms.fail = nil
	if _, err := f.send(t, newPhone, testPassword); err != nil {
		t.Fatalf("gidemeyen kod beklemeyi tutmamali: %v", err)
	}
	_, err = f.send(t, newPhone, testPassword)
	if code := testkit.AppErrorOf(t, err).Code; code != apperror.CodeRateLimited {
		t.Errorf("60 sn dolmadan 429: %v", code)
	}
}

func TestWrongCodeIsNamedOnTheField(t *testing.T) {
	f := newFixture(t)
	if _, err := f.send(t, newPhone, testPassword); err != nil {
		t.Fatalf("kod: %v", err)
	}

	_, err := f.verify(t, newPhone, "999999")

	expectField(t, err, apperror.CodeValidationFailed, verification.FieldCode, "Kod hatalı. 4 deneme hakkın kaldı.")
	if user, err := f.users.ByID(t.Context(), f.identity.UserID); err != nil || user.Phone != oldPhone {
		t.Errorf("yanlis kod numarayi degistirmemeli: %q", user.Phone)
	}
}

func TestInputChecks(t *testing.T) {
	if problems := (SendInput{Phone: "05321234567"}).Check(); problems[FieldPhone] == "" {
		t.Errorf("bicimsiz numara: %v", problems)
	}
	if problems := (SendInput{Phone: newPhone, Password: "kisa"}).Check(); problems[FieldPassword] == "" {
		t.Errorf("kisa sifre: %v", problems)
	}
	if problems := (SendInput{Phone: newPhone}).Check(); len(problems) != 0 {
		t.Errorf("sifresiz gecerli (dogrulama): %v", problems)
	}
	problems := (VerifyInput{Phone: "abc", Code: "12a"}).Check()
	if problems[FieldPhone] == "" || problems[verification.FieldCode] != verification.CodeReason {
		t.Errorf("iki alan birden: %v", problems)
	}
}

func TestCodeTextCarriesCodeAndValidity(t *testing.T) {
	text := codeText(testCode)
	if !strings.Contains(text, testCode) || !strings.Contains(text, "10 dakika") || strings.Contains(text, "\n") {
		t.Errorf("tek satir, kod ve sure: %q", text)
	}
}
