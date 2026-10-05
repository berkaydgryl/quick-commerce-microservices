//go:build integration

// QA kara kutu (T11.14 PR 3, #122; QA incelemesi 7): e-posta ve telefon
// kodlari AYNI Redis'te, uretimdeki gibi kanal basina depo ve ayri kod
// anahtariyla (cmd/gateway buildVerificationStore). HTTP uclari uzerinden:
// iki kanalda ayni anda bekleyen kod; birinin kodu otekinde gecmez, birinin
// yanlis denemesi ve kilidi otekinin hakkini ve kaydini bozmaz, bekleme
// suresi paylasilmaz.
//
// Calistirma (Docker gerekir): go test -tags integration -run TestQA ./internal/verification/
package verification_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/testcontainers/testcontainers-go"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
	"golang.org/x/crypto/bcrypt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/emailverify"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/httpapi"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mail"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/phoneverify"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/redisdb"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/verification"
)

const (
	qaChannelPassword  = "Gizli-Parola-2026"
	qaChannelEmailCode = "111222"
	qaChannelPhoneCode = "333444"
)

type qaChannelSMS struct {
	mu   sync.Mutex
	sent int
}

func (s *qaChannelSMS) Send(context.Context, string, string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent++
	return nil
}

// qaChannelApp, iki dogrulama servisi tek Redis'te, kanal basina depo.
func qaChannelApp(t *testing.T) *fiber.App {
	t.Helper()
	ctx := context.Background()
	container, err := tcredis.Run(ctx, "redis:7-alpine")
	if err != nil {
		t.Fatalf("redis konteyneri: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(container); err != nil {
			t.Errorf("konteyner kapatilamadi: %v", err)
		}
	})
	url, err := container.ConnectionString(ctx)
	if err != nil {
		t.Fatalf("baglanti dizesi: %v", err)
	}
	redisClient, err := redisdb.Connect(ctx, redisdb.Options{URL: url, ConnectTimeout: 10 * time.Second, OperationTimeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("redis: %v", err)
	}
	t.Cleanup(func() {
		if err := redisClient.Close(); err != nil {
			t.Errorf("redis kapatilamadi: %v", err)
		}
	})

	passwords, err := auth.NewPasswordHasher(bcrypt.MinCost)
	if err != nil {
		t.Fatalf("sifre ozetleyici: %v", err)
	}
	users, sessions := authstore.NewMemoryUsers(), authstore.NewMemorySessions()
	tokens := auth.NewTokens([]byte("yalnizca-qa-testi-icin-imza-sirri-32-bayttan-uzun"), time.Hour, time.Now)
	identity := auth.NewService(auth.Deps{
		Users: users, Sessions: sessions, Passwords: passwords,
		Tokens: tokens, RefreshTTL: 14 * 24 * time.Hour, Now: time.Now,
	})
	emails := emailverify.NewService(emailverify.Deps{
		Accounts: users, Store: verification.NewRedis(redisClient, verification.ChannelEmail), Mailer: mail.NewMemory(),
		CodeKey: []byte("qa-eposta-anahtari"), Now: time.Now,
		NewCode: func() string { return qaChannelEmailCode },
	})
	phones := phoneverify.NewService(phoneverify.Deps{
		Accounts: users, Sessions: sessions, Passwords: passwords,
		Store: verification.NewRedis(redisClient, verification.ChannelPhone), SMS: &qaChannelSMS{},
		CodeKey: []byte("qa-telefon-anahtari"), Now: time.Now,
		NewCode: func() string { return qaChannelPhoneCode },
	})
	return httpapi.New(httpapi.Deps{
		UserRegistrar: identity, ProfileGetter: identity,
		EmailCodeSender: emails, EmailVerifier: emails,
		PhoneCodeSender: phones, PhoneVerifier: phones,
		AccessTokens: tokens,
		Idempotency: httpapi.Idempotency{
			Store: idempotency.NewMemory(time.Now), FingerprintKey: []byte("qa-parmak-izi"), TTL: time.Hour,
		},
		Logger: slog.New(slog.NewJSONHandler(io.Discard, nil)),
	})
}

// qaChannelPost, korumali POST; durum, hata kodu ve ham veri.
func qaChannelPost(t *testing.T, app *fiber.App, path, access, body string) (int, apperror.Code, json.RawMessage) {
	t.Helper()
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(body))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	request.Header.Set(httpapi.IdempotencyKeyHeader, "qa-"+ids.New("k"))
	if access != "" {
		request.Header.Set(fiber.HeaderAuthorization, "Bearer "+access)
	}
	response, err := app.Test(request, fiber.TestConfig{Timeout: 30 * time.Second})
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	raw, readErr := io.ReadAll(response.Body)
	if closeErr := response.Body.Close(); closeErr != nil {
		t.Errorf("govde kapatilamadi: %v", closeErr)
	}
	if readErr != nil {
		t.Fatalf("govde okunamadi: %v", readErr)
	}
	var envelope struct {
		Data  json.RawMessage `json:"data"`
		Error *struct {
			Code apperror.Code `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatalf("zarf cozulemedi: %v %s", err, raw)
	}
	if envelope.Error != nil {
		return response.StatusCode, envelope.Error.Code, envelope.Data
	}
	return response.StatusCode, "", envelope.Data
}

func TestQAEmailAndPhoneCodesDoNotCrossOrDisturbEachOther(t *testing.T) {
	app := qaChannelApp(t)
	status, code, data := qaChannelPost(t, app, "/v1/auth/register", "",
		`{"phone":"+905321114001","password":"`+qaChannelPassword+`","fullName":"Kanal Hesabi"}`)
	var grant auth.Grant
	if status != http.StatusCreated || json.Unmarshal(data, &grant) != nil {
		t.Fatalf("kayit: %d %s", status, code)
	}
	access := grant.AccessToken
	email, phone := "kanal@example.com", "+905551114001"
	sendEmail := func() (int, apperror.Code) {
		status, code, _ := qaChannelPost(t, app, "/v1/me/email/code", access, `{"email":"`+email+`"}`)
		return status, code
	}
	sendPhone := func() (int, apperror.Code) {
		status, code, _ := qaChannelPost(t, app, "/v1/me/phone/code", access, `{"phone":"`+phone+`","password":"`+qaChannelPassword+`"}`)
		return status, code
	}
	verifyEmail := func(code string) (int, apperror.Code) {
		status, errCode, _ := qaChannelPost(t, app, "/v1/me/email/verify", access, `{"email":"`+email+`","code":"`+code+`"}`)
		return status, errCode
	}
	verifyPhone := func(code string) (int, apperror.Code) {
		status, errCode, _ := qaChannelPost(t, app, "/v1/me/phone/verify", access, `{"phone":"`+phone+`","code":"`+code+`"}`)
		return status, errCode
	}

	// Bekleme paylasilmaz: e-postadan hemen sonra telefon kodu da gider.
	if status, code := sendEmail(); status != http.StatusAccepted {
		t.Fatalf("e-posta kodu: %d %s", status, code)
	}
	if status, code := sendPhone(); status != http.StatusAccepted {
		t.Fatalf("telefon kodu e-postanin 60 sn beklemesine takilmamali: %d %s", status, code)
	}
	if status, code := sendEmail(); status != http.StatusTooManyRequests || code != apperror.CodeRateLimited {
		t.Errorf("e-postanin kendi beklemesi surmeli: %d %s", status, code)
	}

	// Kod kanal disinda gecmez.
	if status, code := verifyPhone(qaChannelEmailCode); status != http.StatusBadRequest || code != apperror.CodeValidationFailed {
		t.Errorf("e-posta kodu telefonda gecmemeli: %d %s", status, code)
	}
	if status, code := verifyEmail(qaChannelPhoneCode); status != http.StatusBadRequest || code != apperror.CodeValidationFailed {
		t.Errorf("telefon kodu e-postada gecmemeli: %d %s", status, code)
	}

	// Telefon kilitlenir (kalan 4 yanlis); e-postanin hakki ve kaydi yerinde.
	for attempt := 1; attempt < verification.MaxAttempts; attempt++ {
		if status, _ := verifyPhone("000000"); status != http.StatusBadRequest {
			t.Fatalf("telefon yanlis kod %d: %d", attempt, status)
		}
	}
	if status, _ := verifyPhone(qaChannelPhoneCode); status != http.StatusBadRequest {
		t.Errorf("telefon kilitli olmali: %d", status)
	}
	for attempt := 2; attempt < verification.MaxAttempts; attempt++ {
		if status, _ := verifyEmail("000000"); status != http.StatusBadRequest {
			t.Fatalf("e-posta yanlis kod %d: %d", attempt, status)
		}
	}
	status, code, data = qaChannelPost(t, app, "/v1/me/email/verify", access, `{"email":"`+email+`","code":"`+qaChannelEmailCode+`"}`)
	var profile auth.Profile
	if status != http.StatusOK || json.Unmarshal(data, &profile) != nil || profile.Email != email {
		t.Errorf("e-posta son hakkinda dogrulanmali (telefonun kilidi bozmamali): %d %s %+v", status, code, profile)
	}
}
