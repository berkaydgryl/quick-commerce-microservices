package httpapi

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"golang.org/x/crypto/bcrypt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/emailverify"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mail"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ratelimit"
)

// E-posta dogrulama (T11.14) gercek servislerle sinanir: kayit -> kod ->
// dogrulama -> profil. Ileti bellek kutusuna, kod bilinir.

const (
	emailTestCode    = "042137"
	emailTestAddress = "ayse@ornek.com"
)

func emailApp(t *testing.T, limits RateLimit) *fiber.App {
	t.Helper()
	passwords, err := auth.NewPasswordHasher(bcrypt.MinCost)
	if err != nil {
		t.Fatalf("sifre ozetleyici kurulamadi: %v", err)
	}
	users := authstore.NewMemoryUsers()
	identity := auth.NewService(auth.Deps{
		Users: users, Sessions: authstore.NewMemorySessions(), Passwords: passwords,
		Tokens: testTokens(), RefreshTTL: testRefresh, Now: time.Now,
	})
	verification := emailverify.NewService(emailverify.Deps{
		Accounts: users, Store: emailverify.NewMemory(time.Now), Mailer: mail.NewMemory(),
		CodeKey: []byte("test-anahtari"), Now: time.Now, NewCode: func() string { return emailTestCode },
	})
	return New(Deps{
		Health:          fakeReporter{report: healthyReport()},
		UserRegistrar:   identity,
		ProfileGetter:   identity,
		EmailCodeSender: verification,
		EmailVerifier:   verification,
		AccessTokens:    testTokens(),
		Idempotency:     testIdempotency(),
		RateLimit:       limits,
		Logger:          silentLogger(),
	})
}

func emailRequest(t *testing.T, path, authorization, key, body string) *http.Request {
	t.Helper()
	headers := map[string]string{fiber.HeaderAuthorization: authorization}
	if key != "" {
		headers[IdempotencyKeyHeader] = key
	}
	return jsonRequest(t, http.MethodPost, path, body, headers)
}

func TestEmailVerificationFlow(t *testing.T) {
	app := emailApp(t, RateLimit{})
	authorization := signedUp(t, app)

	status, header, envelope := exchange(t, app, emailRequest(t, "/v1/me/email/code", authorization, "eposta-0001", `{"email":"  Ayse@Ornek.com "}`))
	sent := dataOf[emailverify.Sent](t, envelope)
	if status != http.StatusAccepted || sent != (emailverify.Sent{Email: emailTestAddress, ExpiresInSeconds: 600, ResendAfterSeconds: 60}) ||
		header.Get(fiber.HeaderCacheControl) != noStore {
		t.Fatalf("202, kucuk harfli adres, sureler ve no-store bekleniyordu: %d %+v", status, envelope)
	}

	status, envelope = send(t, app, emailRequest(t, "/v1/me/email/verify", authorization, "eposta-0002", `{"email":"ayse@ornek.com","code":"`+emailTestCode+`"}`))
	if profile := dataOf[auth.Profile](t, envelope); status != http.StatusOK || profile.Email != emailTestAddress {
		t.Fatalf("200 ve e-postali profil bekleniyordu: %d %+v", status, envelope)
	}

	status, envelope = send(t, app, jsonRequest(t, http.MethodGet, "/v1/me", "", map[string]string{fiber.HeaderAuthorization: authorization}))
	if profile := dataOf[auth.Profile](t, envelope); status != http.StatusOK || profile.Email != emailTestAddress {
		t.Errorf("GET /v1/me dogrulanmis adresi gostermeli: %d %+v", status, envelope)
	}
}

func TestProfileWithoutEmailOmitsTheField(t *testing.T) {
	app := emailApp(t, RateLimit{})
	authorization := signedUp(t, app)

	_, _, raw := exchangeRaw(t, app, jsonRequest(t, http.MethodGet, "/v1/me", "", map[string]string{fiber.HeaderAuthorization: authorization}))

	if strings.Contains(string(raw), `"email"`) {
		t.Errorf("e-postasiz profilde alan hic yazilmamali (sozlesme: istege bagli): %s", raw)
	}
}

func TestEmailCodeResendTooSoonSetsRetryAfter(t *testing.T) {
	app := emailApp(t, RateLimit{})
	authorization := signedUp(t, app)
	body := `{"email":"ayse@ornek.com"}`
	if status, envelope := send(t, app, emailRequest(t, "/v1/me/email/code", authorization, "eposta-0001", body)); status != http.StatusAccepted {
		t.Fatalf("ilk kod: %d %+v", status, envelope)
	}

	status, header, envelope := exchange(t, app, emailRequest(t, "/v1/me/email/code", authorization, "eposta-0002", body))

	seconds, _ := detailsOf(t, envelope)[apperror.RetryAfterDetail].(float64)
	if status != http.StatusTooManyRequests || envelope.Error.Code != apperror.CodeRateLimited || seconds < 59 || seconds > 60 ||
		header.Get(fiber.HeaderRetryAfter) == "" {
		t.Errorf("429, Retry-After ve retryAfterSeconds bekleniyordu: %d %v %+v", status, header.Get(fiber.HeaderRetryAfter), envelope)
	}
}

func TestEmailEndpointsCollectFormatErrors(t *testing.T) {
	app := emailApp(t, RateLimit{})
	authorization := signedUp(t, app)

	status, envelope := send(t, app, emailRequest(t, "/v1/me/email/code", authorization, "", `{"email":"ayse"}`))
	details := detailsOf(t, envelope)
	if status != http.StatusBadRequest || details[IdempotencyKeyHeader] == nil || details[emailverify.FieldEmail] == nil {
		t.Errorf("anahtar ve adres hatasi birlikte donmeli: %d %+v", status, envelope)
	}

	status, envelope = send(t, app, emailRequest(t, "/v1/me/email/verify", authorization, "eposta-0003", `{"email":"ayse@ornek.com","code":"12ab"}`))
	if status != http.StatusBadRequest || detailsOf(t, envelope)[emailverify.FieldCode] == nil {
		t.Errorf("bicimsiz kod 400 ve code ayrintisi donmeli: %d %+v", status, envelope)
	}

	status, envelope = send(t, app, emailRequest(t, "/v1/me/email/code", authorization, "eposta-0004", `{"email":"ayse@ornek.com","phone":"+905321234567"}`))
	if status != http.StatusBadRequest || detailsOf(t, envelope)["phone"] != unknownFieldReason {
		t.Errorf("bilinmeyen alan reddedilmeli: %d %+v", status, envelope)
	}
}

func TestEmailVerifyWithWrongCodeNamesTheField(t *testing.T) {
	app := emailApp(t, RateLimit{})
	authorization := signedUp(t, app)
	if status, envelope := send(t, app, emailRequest(t, "/v1/me/email/code", authorization, "eposta-0001", `{"email":"ayse@ornek.com"}`)); status != http.StatusAccepted {
		t.Fatalf("kod: %d %+v", status, envelope)
	}

	status, envelope := send(t, app, emailRequest(t, "/v1/me/email/verify", authorization, "eposta-0002", `{"email":"ayse@ornek.com","code":"999999"}`))

	if reason, _ := detailsOf(t, envelope)[emailverify.FieldCode].(string); status != http.StatusBadRequest || !strings.HasPrefix(reason, "Kod hatalı.") {
		t.Errorf("yanlis kod alanin altinda soylenmeli: %d %+v", status, envelope)
	}
}

func TestEmailEndpointsNeedIdentity(t *testing.T) {
	app := emailApp(t, RateLimit{})
	for _, path := range []string{"/v1/me/email/code", "/v1/me/email/verify"} {
		if status, _ := send(t, app, emailRequest(t, path, "", "eposta-0001", `{}`)); status != http.StatusUnauthorized {
			t.Errorf("%s kimliksiz 401 olmali: %d", path, status)
		}
	}
}

func TestEmailVerifyUsesTheStrictAuthLimit(t *testing.T) {
	// F5 (a): kod denemesi kimlik uclarinin sinirinda (kullanici basina), genel
	// sinirda degil. Sinir 2 iken ucuncu deneme 429.
	app := emailApp(t, RateLimit{Limiter: ratelimit.NewMemory(time.Now), Window: time.Minute, General: 100, Auth: 2, Order: 100})
	authorization := signedUp(t, app)
	body := `{"email":"ayse@ornek.com","code":"999999"}`

	statuses := make([]int, 0, 3)
	for _, key := range []string{"eposta-0001", "eposta-0002", "eposta-0003"} {
		status, _ := send(t, app, emailRequest(t, "/v1/me/email/verify", authorization, key, body))
		statuses = append(statuses, status)
	}

	if statuses[0] != http.StatusBadRequest || statuses[1] != http.StatusBadRequest || statuses[2] != http.StatusTooManyRequests {
		t.Errorf("iki deneme sonra 429 bekleniyordu: %v", statuses)
	}
}
