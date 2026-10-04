package emailverify

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mail"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/verification"
)

// fakeClock, elle ilerleyen saat; es zamanli okumaya karsi kilitli.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newFakeClock() *fakeClock {
	return &fakeClock{now: time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)}
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

// Kod cumleleri verification'dadir; burada metinleriyle denetlenir.
const (
	codeExpiredReason = "Kodun süresi doldu. Yeni kod isteyebilirsin."
	codeLockedReason  = "Kod 5 kez hatalı girildi. Yeni kod isteyebilirsin."
)

const (
	testEmail = "ayse@ornek.com"
	testCode  = "042137"
)

// fixture, servis ve cevresi: gercek bellek depolari (kurallari Mongo ve
// Redis'tekiyle ayni), sahte saat, bilinen kod.
type fixture struct {
	service *Service
	users   *authstore.MemoryUsers
	store   *verification.Memory
	mailer  *recordingMailer
	clock   *fakeClock
	userID  string
}

// recordingMailer, iletileri tutar; fail doluysa gondermez.
type recordingMailer struct {
	box  *mail.Memory
	fail error
}

func (m *recordingMailer) Send(ctx context.Context, msg mail.Message) error {
	if m.fail != nil {
		return m.fail
	}
	return m.box.Send(ctx, msg)
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	clock := newFakeClock()
	users := authstore.NewMemoryUsers()
	userID := ids.New(ids.User)
	if err := users.Create(t.Context(), auth.User{ID: userID, Phone: "+905321234567", FullName: "Ayşe Yılmaz"}); err != nil {
		t.Fatalf("kullanici yazilamadi: %v", err)
	}
	f := &fixture{users: users, store: verification.NewMemory(clock.Now), mailer: &recordingMailer{box: mail.NewMemory()}, clock: clock, userID: userID}
	f.service = NewService(Deps{
		Accounts: users, Store: f.store, Mailer: f.mailer, CodeKey: []byte("test-anahtari"),
		Now: clock.Now, NewCode: func() string { return testCode },
	})
	return f
}

func (f *fixture) send(t *testing.T, email string) (Sent, error) {
	t.Helper()
	input := SendInput{Email: email}
	if problems := input.Check(); len(problems) > 0 {
		t.Fatalf("gecerli girdi bekleniyordu: %v", problems)
	}
	return f.service.SendCode(t.Context(), f.userID, input)
}

func (f *fixture) verify(t *testing.T, email, code string) (auth.Profile, error) {
	t.Helper()
	input := VerifyInput{Email: email, Code: code}
	if problems := input.Check(); len(problems) > 0 {
		t.Fatalf("gecerli girdi bekleniyordu: %v", problems)
	}
	return f.service.Verify(t.Context(), f.userID, input)
}

// expectField, hatanin VALIDATION_FAILED ve alanin sebebi oldugunu dogrular.
func expectField(t *testing.T, err error, field, reason string) {
	t.Helper()
	appErr := testkit.AppErrorOf(t, err)
	if appErr.Code != apperror.CodeValidationFailed || appErr.Details[field] != reason {
		t.Fatalf("%s alaninda %q bekleniyordu: %+v", field, reason, appErr)
	}
}

func TestSendCodeMailsTheCodeAndReportsDurations(t *testing.T) {
	f := newFixture(t)

	sent, err := f.send(t, "  Ayse@Ornek.COM ")

	if err != nil {
		t.Fatalf("gonderilemedi: %v", err)
	}
	if sent != (Sent{Email: testEmail, ExpiresInSeconds: 600, ResendAfterSeconds: 60}) {
		t.Errorf("cevap: %+v", sent)
	}
	messages := f.mailer.box.Sent()
	if len(messages) != 1 || messages[0].To != testEmail {
		t.Fatalf("tek ileti kucuk harfli adrese gitmeli: %+v", messages)
	}
	if !strings.Contains(messages[0].Text, testCode) || !strings.Contains(messages[0].HTML, testCode) {
		t.Error("kod iki govdede de olmali")
	}
	if strings.Contains(messages[0].Subject, testCode) {
		t.Error("kod konuya yazilmamali (bildirimde gorunur)")
	}
}

func TestSendCodeTooSoonIsRateLimitedWithoutMail(t *testing.T) {
	f := newFixture(t)
	if _, err := f.send(t, testEmail); err != nil {
		t.Fatalf("ilk gonderim: %v", err)
	}
	f.clock.Advance(20*time.Second + 300*time.Millisecond)

	_, err := f.send(t, testEmail)

	appErr := testkit.AppErrorOf(t, err)
	if appErr.Code != apperror.CodeRateLimited || appErr.Details[apperror.RetryAfterDetail] != 40 {
		t.Fatalf("429 ve yukari yuvarlanmis 40 sn bekleniyordu: %+v", appErr)
	}
	if apperror.HTTPStatus(appErr.Code) != http.StatusTooManyRequests {
		t.Errorf("RATE_LIMITED 429 olmali")
	}
	if len(f.mailer.box.Sent()) != 1 {
		t.Error("bekleme bitmeden ikinci ileti gitmemeli")
	}
}

func TestSendCodeRejectsCurrentAndTakenAddresses(t *testing.T) {
	f := newFixture(t)
	other := ids.New(ids.User)
	if err := f.users.Create(t.Context(), auth.User{ID: other, Phone: "+905559876543", FullName: "Mehmet"}); err != nil {
		t.Fatalf("ikinci kullanici: %v", err)
	}
	if err := f.users.SetVerifiedEmail(t.Context(), other, "mehmet@ornek.com", f.clock.Now()); err != nil {
		t.Fatalf("ikinci kullanicinin adresi: %v", err)
	}
	if err := f.users.SetVerifiedEmail(t.Context(), f.userID, testEmail, f.clock.Now()); err != nil {
		t.Fatalf("adres: %v", err)
	}

	_, err := f.send(t, "Mehmet@ornek.com")
	expectField(t, err, FieldEmail, emailTakenReason)
	_, err = f.send(t, testEmail)
	expectField(t, err, FieldEmail, emailCurrentReason)

	if len(f.mailer.box.Sent()) != 0 {
		t.Error("reddedilen adrese ileti gitmemeli")
	}
}

func TestSendCodeMailFailureIsUnavailableAndFreesTheWait(t *testing.T) {
	f := newFixture(t)
	f.mailer.fail = errors.New("smtp baglantisi: reddedildi")

	_, err := f.send(t, testEmail)

	if code := testkit.AppErrorOf(t, err).Code; code != apperror.CodeServiceUnavailable {
		t.Fatalf("503 bekleniyordu: %v", code)
	}
	f.mailer.fail = nil
	if _, err := f.send(t, testEmail); err != nil {
		t.Fatalf("gonderilemeyen kod beklemeyi tutmamali: %v", err)
	}
}

func TestSendCodeForDeletedUserIsUnauthorized(t *testing.T) {
	f := newFixture(t)
	f.userID = ids.New(ids.User)

	_, err := f.send(t, testEmail)

	if code := testkit.AppErrorOf(t, err).Code; code != apperror.CodeUnauthorized {
		t.Fatalf("401 bekleniyordu: %v", code)
	}
}

func TestVerifyWritesTheAddressAndReturnsProfile(t *testing.T) {
	f := newFixture(t)
	if _, err := f.send(t, testEmail); err != nil {
		t.Fatalf("gonderim: %v", err)
	}

	profile, err := f.verify(t, "AYSE@ornek.com", testCode)

	if err != nil {
		t.Fatalf("dogrulanamadi: %v", err)
	}
	if profile.Email != testEmail || profile.ID != f.userID {
		t.Errorf("profil dogrulanmis adresi tasimali: %+v", profile)
	}
	user, err := f.users.ByID(t.Context(), f.userID)
	if err != nil || user.Email != testEmail || !user.EmailVerifiedAt.Equal(f.clock.Now()) {
		t.Errorf("kayit: %+v (%v)", user, err)
	}
	// Kod tek kullanimliktir.
	_, err = f.verify(t, testEmail, testCode)
	expectField(t, err, verification.FieldCode, codeExpiredReason)
}

func TestVerifyCountsWrongCodesThenLocks(t *testing.T) {
	f := newFixture(t)
	if _, err := f.send(t, testEmail); err != nil {
		t.Fatalf("gonderim: %v", err)
	}

	for left := verification.MaxAttempts - 1; left > 0; left-- {
		_, err := f.verify(t, testEmail, "999999")
		expectField(t, err, verification.FieldCode, "Kod hatalı. "+string(rune('0'+left))+" deneme hakkın kaldı.")
	}
	_, err := f.verify(t, testEmail, "999999")
	expectField(t, err, verification.FieldCode, codeLockedReason)
	_, err = f.verify(t, testEmail, testCode)
	expectField(t, err, verification.FieldCode, codeLockedReason)

	user, err := f.users.ByID(t.Context(), f.userID)
	if err != nil || user.Email != "" {
		t.Errorf("kilitli kod adresi yazmamali: %+v (%v)", user, err)
	}
}

func TestVerifyAfterTenMinutesIsExpired(t *testing.T) {
	f := newFixture(t)
	if _, err := f.send(t, testEmail); err != nil {
		t.Fatalf("gonderim: %v", err)
	}
	f.clock.Advance(verification.CodeTTL)

	_, err := f.verify(t, testEmail, testCode)

	expectField(t, err, verification.FieldCode, codeExpiredReason)
}

func TestVerifyForAnotherAddressIsExpired(t *testing.T) {
	// Baska sekmede yeni adrese kod istendiyse eski pencerenin kodu yanlis adresi
	// dogrulamaz.
	f := newFixture(t)
	if _, err := f.send(t, testEmail); err != nil {
		t.Fatalf("gonderim: %v", err)
	}

	_, err := f.verify(t, "baska@ornek.com", testCode)

	expectField(t, err, verification.FieldCode, codeExpiredReason)
}

func TestVerifyLosesRaceToAnotherAccount(t *testing.T) {
	// Iki hesap ayni adrese kod istedi; digeri once dogruladi. Karar benzersiz
	// indekstedir (bellekte byEmail).
	f := newFixture(t)
	if _, err := f.send(t, testEmail); err != nil {
		t.Fatalf("gonderim: %v", err)
	}
	other := ids.New(ids.User)
	if err := f.users.Create(t.Context(), auth.User{ID: other, Phone: "+905559876543", FullName: "Mehmet"}); err != nil {
		t.Fatalf("ikinci kullanici: %v", err)
	}
	if err := f.users.SetVerifiedEmail(t.Context(), other, testEmail, f.clock.Now()); err != nil {
		t.Fatalf("ikinci kullanicinin adresi: %v", err)
	}

	_, err := f.verify(t, testEmail, testCode)

	expectField(t, err, FieldEmail, emailTakenReason)
}
