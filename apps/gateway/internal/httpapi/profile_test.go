package httpapi

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"golang.org/x/crypto/bcrypt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/phoneverify"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/verification"
)

// Profil duzenleme (T11.14 PR 3) gercek servislerle sinanir: kayit -> ad ->
// telefon kodu -> dogrulama. SMS bellekte, kod bilinir.

const (
	profileTestCode  = "042137"
	profileNewPhone  = "+905559876543"
	profileTestToken = "Bearer "
)

type memorySMS struct {
	mu sync.Mutex
	to []string
}

func (m *memorySMS) Send(_ context.Context, phone, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.to = append(m.to, phone)
	return nil
}

func profileApp(t *testing.T, withPhone bool) (*fiber.App, *authstore.MemorySessions) {
	t.Helper()
	passwords, err := auth.NewPasswordHasher(bcrypt.MinCost)
	if err != nil {
		t.Fatalf("sifre ozetleyici kurulamadi: %v", err)
	}
	users, sessions := authstore.NewMemoryUsers(), authstore.NewMemorySessions()
	identity := auth.NewService(auth.Deps{
		Users: users, Sessions: sessions, Passwords: passwords,
		Tokens: testTokens(), RefreshTTL: testRefresh, Now: time.Now,
	})
	deps := Deps{
		Health:            fakeReporter{report: healthyReport()},
		UserRegistrar:     identity,
		UserAuthenticator: identity,
		ProfileGetter:     identity,
		ProfileUpdater:    identity,
		AccessTokens:      testTokens(),
		Idempotency:       testIdempotency(),
		Logger:            silentLogger(),
	}
	if withPhone {
		phones := phoneverify.NewService(phoneverify.Deps{
			Accounts: users, Sessions: sessions, Passwords: passwords, Store: verification.NewMemory(time.Now),
			SMS: &memorySMS{}, CodeKey: []byte("test-anahtari"), Now: time.Now,
			NewCode: func() string { return profileTestCode },
		})
		deps.PhoneCodeSender, deps.PhoneVerifier = phones, phones
	}
	return New(deps), sessions
}

func profileRequest(t *testing.T, method, path, authorization, key, body string) *http.Request {
	t.Helper()
	headers := map[string]string{fiber.HeaderAuthorization: authorization}
	if key != "" {
		headers[IdempotencyKeyHeader] = key
	}
	return jsonRequest(t, method, path, body, headers)
}

func TestUpdateProfileChangesTheName(t *testing.T) {
	app, _ := profileApp(t, false)
	authorization := signedUp(t, app)

	status, header, envelope := exchange(t, app, profileRequest(t, http.MethodPatch, "/v1/me", authorization, "profil-0001", `{"fullName":"  Ayşe Kaya "}`))
	if profile := dataOf[auth.Profile](t, envelope); status != http.StatusOK || profile.FullName != "Ayşe Kaya" || header.Get(fiber.HeaderCacheControl) != noStore {
		t.Fatalf("200, kirpilmis ad ve no-store bekleniyordu: %d %+v", status, envelope)
	}
	status, envelope = send(t, app, jsonRequest(t, http.MethodGet, "/v1/me", "", map[string]string{fiber.HeaderAuthorization: authorization}))
	if profile := dataOf[auth.Profile](t, envelope); profile.FullName != "Ayşe Kaya" {
		t.Errorf("GET /v1/me yeni adi gostermeli: %d %+v", status, envelope)
	}
}

func TestUpdateProfileValidatesTheName(t *testing.T) {
	app, _ := profileApp(t, false)
	authorization := signedUp(t, app)

	status, envelope := send(t, app, profileRequest(t, http.MethodPatch, "/v1/me", authorization, "", `{"fullName":"A"}`))
	details := detailsOf(t, envelope)
	if status != http.StatusBadRequest || details[auth.FieldFullName] == nil || details[IdempotencyKeyHeader] == nil {
		t.Errorf("kisa ad ve eksik anahtar birlikte donmeli: %d %+v", status, envelope)
	}
	status, envelope = send(t, app, profileRequest(t, http.MethodPatch, "/v1/me", authorization, "profil-0002", `{"phone":"+905321234567"}`))
	if status != http.StatusBadRequest || detailsOf(t, envelope)["phone"] != unknownFieldReason {
		t.Errorf("PATCH /v1/me telefonu kabul etmez (bilinmeyen alan): %d %+v", status, envelope)
	}
}

func TestPhoneChangeFlowKeepsThisSessionOnly(t *testing.T) {
	app, sessions := profileApp(t, true)
	authorization := signedUp(t, app)
	// Ayni hesaba ikinci cihazdan giris.
	if status, envelope := send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/login", loginBodyOf(testPhone, testPassword), nil)); status != http.StatusOK {
		t.Fatalf("ikinci giris: %d %+v", status, envelope)
	}

	status, envelope := send(t, app, profileRequest(t, http.MethodPost, "/v1/me/phone/code", authorization, "telefon-0001",
		`{"phone":"`+profileNewPhone+`","password":"`+testPassword+`"}`))
	if sent := dataOf[phoneverify.Sent](t, envelope); status != http.StatusAccepted || sent.Phone != profileNewPhone || sent.ExpiresInSeconds != 600 {
		t.Fatalf("202 ve sureler bekleniyordu: %d %+v", status, envelope)
	}
	status, envelope = send(t, app, profileRequest(t, http.MethodPost, "/v1/me/phone/verify", authorization, "telefon-0002",
		`{"phone":"`+profileNewPhone+`","code":"`+profileTestCode+`"}`))
	if profile := dataOf[auth.Profile](t, envelope); status != http.StatusOK || profile.Phone != profileNewPhone || !profile.PhoneVerified {
		t.Fatalf("200 ve yeni, dogrulanmis numara bekleniyordu: %d %+v", status, envelope)
	}

	// Bu oturumun erisim jetonu gecerli; ikinci cihazin oturumu kapandi.
	if status, _ = send(t, app, jsonRequest(t, http.MethodGet, "/v1/me", "", map[string]string{fiber.HeaderAuthorization: authorization})); status != http.StatusOK {
		t.Errorf("bu oturum surmeli: %d", status)
	}
	identity, err := testTokens().Verify(strings.TrimPrefix(authorization, profileTestToken))
	if err != nil {
		t.Fatalf("jeton: %v", err)
	}
	if revoked, err := sessions.RevokeOthers(t.Context(), identity.UserID, identity.SessionID); err != nil || revoked != 0 {
		t.Errorf("diger oturum zaten kapanmis olmali: %d", revoked)
	}
	// Yeni numarayla giris.
	if status, _ = send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/login", loginBodyOf(profileNewPhone, testPassword), nil)); status != http.StatusOK {
		t.Errorf("yeni numarayla giris olmali: %d", status)
	}
}

func TestPhoneResendWithoutPasswordWaitsInsteadOfAskingForIt(t *testing.T) {
	// Web'in "Kodu yeniden gönder"i yalnizca numarayi yollar: bekleyen kod o
	// numaradayken sifre sorulmaz, yalnizca 60 sn beklemesi (429) isler.
	app, _ := profileApp(t, true)
	authorization := signedUp(t, app)
	if status, envelope := send(t, app, profileRequest(t, http.MethodPost, "/v1/me/phone/code", authorization, "telefon-0001",
		`{"phone":"`+profileNewPhone+`","password":"`+testPassword+`"}`)); status != http.StatusAccepted {
		t.Fatalf("ilk kod: %d %+v", status, envelope)
	}

	status, header, envelope := exchange(t, app, profileRequest(t, http.MethodPost, "/v1/me/phone/code", authorization, "telefon-0002",
		`{"phone":"`+profileNewPhone+`"}`))

	if status != http.StatusTooManyRequests || envelope.Error.Code != apperror.CodeRateLimited || header.Get(fiber.HeaderRetryAfter) == "" {
		t.Errorf("sifresiz yeniden gonderim 429 + Retry-After olmali (400 sifre degil): %d %+v", status, envelope)
	}
}

func TestPhoneCodeErrors(t *testing.T) {
	app, _ := profileApp(t, true)
	authorization := signedUp(t, app)

	status, envelope := send(t, app, profileRequest(t, http.MethodPost, "/v1/me/phone/code", authorization, "telefon-0001",
		`{"phone":"`+profileNewPhone+`","password":"Yanlis-Sifre-2026"}`))
	if status != http.StatusBadRequest || envelope.Error.Code != apperror.CodeValidationFailed || detailsOf(t, envelope)[phoneverify.FieldPassword] == nil {
		t.Errorf("yanlis sifre VALIDATION_FAILED {password}: %d %+v", status, envelope)
	}
	status, envelope = send(t, app, profileRequest(t, http.MethodPost, "/v1/me/phone/code", authorization, "",
		`{"phone":"0532"}`))
	details := detailsOf(t, envelope)
	if status != http.StatusBadRequest || details[phoneverify.FieldPhone] == nil || details[IdempotencyKeyHeader] == nil {
		t.Errorf("bicim ve anahtar birlikte: %d %+v", status, envelope)
	}
}

func TestPhoneEndpointsAreAbsentWithoutService(t *testing.T) {
	// Production'da (gercek SMS yok, #95) uclar hic baglanmaz.
	app, _ := profileApp(t, false)
	authorization := signedUp(t, app)
	for _, path := range []string{"/v1/me/phone/code", "/v1/me/phone/verify"} {
		if status, _ := send(t, app, profileRequest(t, http.MethodPost, path, authorization, "telefon-0001", `{}`)); status != http.StatusNotFound {
			t.Errorf("%s baglanmamali: %d", path, status)
		}
	}
}
