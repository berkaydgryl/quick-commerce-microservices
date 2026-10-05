// QA kara kutu (T11.14 PR 3, #122): profil duzenleme uclari, yalnizca DISA
// ACIK kurucular ve HTTP uzerinden (httpapi.New + gercek servisler, bellek
// depolari, saat elle ilerler). Backend'in profile_test.go'su akisin ana
// yolunu sinar; burada guvenlik incelemesindeki (QA G1/G2) kurallar:
//
//  1. Sifre kurallari tablosu: sifresiz, yanlis, dogru; bekleyen numaraya
//     sifresiz yeniden gonderim; baska numaraya sifresiz ret; kodun omru
//     dolunca sifre yeniden; kilitten sonraki davranis (belgelenir).
//  2. Sahiplik: PHONE_ALREADY_REGISTERED yalnizca dogru sifreyle; sifresiz ya
//     da yanlis sifreli istekte numaranin sahibi sizmaz.
//  4. Oturumlar: digerlerinin yenilemesi 401, bu oturum surer; eski numarayla
//     giris 401, yenisiyle 200; ayni numara dogrulamasi oturumlara dokunmaz;
//     diger cihazin ERISIM jetonu JWT_TTL'e kadar gecer (G1 (a), ADR-12 Ek 2).
//  5. PATCH /v1/me: ad sinirlari, HTML ham saklanir, fazladan alan reddi,
//     tekrar korumasi.
//  6. Gunluk: butun akista kod, numara, sifre, ad ve e-posta gunluge dusmez.
//
// 3 (ayni numaraya eszamanli iki hesap, Mongo) authstore'da, 7 (kanal ayrimi,
// Redis) verification'da, 8 (production'da telefon uclari yok) cmd/gateway'de.
// 9 (SMS kotasi) G2 (a) karariyla #95'e kaldi.
package httpapi_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
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
	"golang.org/x/crypto/bcrypt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/emailverify"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/httpapi"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mail"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/phoneverify"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/verification"
)

const (
	qaPassword   = "Gizli-Parola-2026"
	qaAccessTTL  = time.Hour
	qaRefreshTTL = 14 * 24 * time.Hour
)

var qaSecret = []byte("yalnizca-qa-testi-icin-imza-sirri-32-bayttan-uzun")

// qaClock, testin ilerlettigi saat (jeton, kod ve oturum ayni saatte).
type qaClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *qaClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *qaClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// qaSMS, giden SMS'leri tutar.
type qaSMS struct {
	mu   sync.Mutex
	sent []string
}

func (s *qaSMS) Send(_ context.Context, phone, text string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent = append(s.sent, phone+" "+text)
	return nil
}

func (s *qaSMS) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.sent)
}

// qaLogs, gunluk satirlarini (DEBUG dahil) eszamanli guvenli tutar.
type qaLogs struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (l *qaLogs) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}

func (l *qaLogs) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

// qaWorld, gateway'in kimlik, profil, e-posta ve telefon uclari; kodlari test
// belirler (nextPhoneCode, nextEmailCode).
type qaWorld struct {
	app           *fiber.App
	clock         *qaClock
	sms           *qaSMS
	mails         *mail.Memory
	logs          *qaLogs
	codes         sync.Mutex
	nextPhoneCode string
	nextEmailCode string
}

func newQAWorld(t *testing.T) *qaWorld {
	t.Helper()
	passwords, err := auth.NewPasswordHasher(bcrypt.MinCost)
	if err != nil {
		t.Fatalf("sifre ozetleyici: %v", err)
	}
	w := &qaWorld{
		clock:         &qaClock{now: time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC)},
		sms:           &qaSMS{},
		mails:         mail.NewMemory(),
		logs:          &qaLogs{},
		nextPhoneCode: "481516",
		nextEmailCode: "234234",
	}
	users, sessions := authstore.NewMemoryUsers(), authstore.NewMemorySessions()
	tokens := auth.NewTokens(qaSecret, qaAccessTTL, w.clock.Now)
	identity := auth.NewService(auth.Deps{
		Users: users, Sessions: sessions, Passwords: passwords,
		Tokens: tokens, RefreshTTL: qaRefreshTTL, Now: w.clock.Now,
	})
	phones := phoneverify.NewService(phoneverify.Deps{
		Accounts: users, Sessions: sessions, Passwords: passwords,
		Store: verification.NewMemory(w.clock.Now), SMS: w.sms,
		CodeKey: []byte("qa-telefon-anahtari"), Now: w.clock.Now,
		NewCode: func() string { w.codes.Lock(); defer w.codes.Unlock(); return w.nextPhoneCode },
	})
	emails := emailverify.NewService(emailverify.Deps{
		Accounts: users, Store: verification.NewMemory(w.clock.Now), Mailer: w.mails,
		CodeKey: []byte("qa-eposta-anahtari"), Now: w.clock.Now,
		NewCode: func() string { w.codes.Lock(); defer w.codes.Unlock(); return w.nextEmailCode },
	})
	logger := slog.New(slog.NewJSONHandler(w.logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	w.app = httpapi.New(httpapi.Deps{
		UserRegistrar: identity, UserAuthenticator: identity, SessionRefresher: identity,
		SessionRevoker: identity, ProfileGetter: identity, ProfileUpdater: identity,
		EmailCodeSender: emails, EmailVerifier: emails,
		PhoneCodeSender: phones, PhoneVerifier: phones,
		AccessTokens: tokens,
		Idempotency: httpapi.Idempotency{
			Store: idempotency.NewMemory(w.clock.Now), FingerprintKey: []byte("qa-parmak-izi"), TTL: 24 * time.Hour,
		},
		Logger: logger,
	})
	return w
}

func (w *qaWorld) setPhoneCode(code string) {
	w.codes.Lock()
	defer w.codes.Unlock()
	w.nextPhoneCode = code
}

func (w *qaWorld) setEmailCode(code string) {
	w.codes.Lock()
	defer w.codes.Unlock()
	w.nextEmailCode = code
}

// qaReply, cevabin durum, basliklar ve zarfi.
type qaReply struct {
	status int
	header http.Header
	body   httpapi.Envelope
}

// code, hata zarfinin kodu ("" basarili).
func (r qaReply) code() apperror.Code {
	if r.body.Error == nil {
		return ""
	}
	return r.body.Error.Code
}

// detail, hata ayrintisindaki alan (yoksa nil).
func (r qaReply) detail(field string) any {
	if r.body.Error == nil {
		return nil
	}
	details, ok := r.body.Error.Details.(map[string]any)
	if !ok {
		return nil
	}
	return details[field]
}

func qaData[T any](t *testing.T, r qaReply) T {
	t.Helper()
	var out T
	if !r.body.Success {
		t.Fatalf("basarili zarf bekleniyordu: %d %+v", r.status, r.body.Error)
	}
	raw, err := json.Marshal(r.body.Data)
	if err != nil {
		t.Fatalf("veri kodlanamadi: %v", err)
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("veri cozulemedi: %v", err)
	}
	return out
}

// qaCall, istegin bilesenleri; bos alanlar gonderilmez.
type qaCall struct {
	method, path, auth, key, body, refresh string
}

func (w *qaWorld) do(t *testing.T, call qaCall) qaReply {
	t.Helper()
	request := httptest.NewRequestWithContext(t.Context(), call.method, call.path, strings.NewReader(call.body))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	if call.auth != "" {
		request.Header.Set(fiber.HeaderAuthorization, "Bearer "+call.auth)
	}
	if call.key != "" {
		request.Header.Set(httpapi.IdempotencyKeyHeader, call.key)
	}
	if call.refresh != "" {
		request.AddCookie(&http.Cookie{Name: httpapi.RefreshCookie, Value: call.refresh})
	}
	response, err := w.app.Test(request)
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
	var envelope httpapi.Envelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatalf("zarf cozulemedi (%d): %v %s", response.StatusCode, err, raw)
	}
	return qaReply{status: response.StatusCode, header: response.Header, body: envelope}
}

// qaDevice, bir cihazdaki oturum: erisim jetonu ve yenileme cerezi.
type qaDevice struct {
	access, refresh string
}

func refreshOf(t *testing.T, header http.Header) string {
	t.Helper()
	for _, line := range header.Values(fiber.HeaderSetCookie) {
		cookie, err := http.ParseSetCookie(line)
		if err == nil && cookie.Name == httpapi.RefreshCookie {
			return cookie.Value
		}
	}
	t.Fatalf("yenileme cerezi yok: %v", header.Values(fiber.HeaderSetCookie))
	return ""
}

func qaJSON(t *testing.T, value map[string]string) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("json: %v", err)
	}
	return string(raw)
}

// qaKey, kurala uygun (8-128; harf, rakam, - _) yeni tekrar anahtari.
func qaKey(prefix string) string {
	return prefix + "-" + hex.EncodeToString(randomBytes(8))
}

func randomBytes(n int) []byte {
	out := make([]byte, n)
	if _, err := rand.Read(out); err != nil {
		panic(err)
	}
	return out
}

func (w *qaWorld) register(t *testing.T, phone, fullName string) qaDevice {
	t.Helper()
	r := w.do(t, qaCall{method: http.MethodPost, path: "/v1/auth/register", key: qaKey("kayit"),
		body: qaJSON(t, map[string]string{"phone": phone, "password": qaPassword, "fullName": fullName})})
	if r.status != http.StatusCreated {
		t.Fatalf("kayit: %d %+v", r.status, r.body.Error)
	}
	return qaDevice{access: qaData[auth.Grant](t, r).AccessToken, refresh: refreshOf(t, r.header)}
}

func (w *qaWorld) login(t *testing.T, phone string) (qaReply, qaDevice) {
	t.Helper()
	r := w.do(t, qaCall{method: http.MethodPost, path: "/v1/auth/login",
		body: qaJSON(t, map[string]string{"phone": phone, "password": qaPassword})})
	if r.status != http.StatusOK {
		return r, qaDevice{}
	}
	return r, qaDevice{access: qaData[auth.Grant](t, r).AccessToken, refresh: refreshOf(t, r.header)}
}

func (w *qaWorld) phoneCode(t *testing.T, device qaDevice, phone, password string) qaReply {
	t.Helper()
	body := map[string]string{"phone": phone}
	if password != "" {
		body["password"] = password
	}
	return w.do(t, qaCall{method: http.MethodPost, path: "/v1/me/phone/code", auth: device.access,
		key: qaKey("telefon"), body: qaJSON(t, body)})
}

func (w *qaWorld) phoneVerify(t *testing.T, device qaDevice, phone, code string) qaReply {
	t.Helper()
	return w.do(t, qaCall{method: http.MethodPost, path: "/v1/me/phone/verify", auth: device.access,
		key: qaKey("dogrula"), body: qaJSON(t, map[string]string{"phone": phone, "code": code})})
}

func (w *qaWorld) refresh(t *testing.T, device qaDevice) qaReply {
	t.Helper()
	return w.do(t, qaCall{method: http.MethodPost, path: "/v1/auth/refresh", refresh: device.refresh})
}

func (w *qaWorld) me(t *testing.T, device qaDevice) qaReply {
	t.Helper()
	return w.do(t, qaCall{method: http.MethodGet, path: "/v1/me", auth: device.access})
}

// 1. Sifre kurallari tablosu (adim adim, ayni hesap, saat ilerler).
func TestQAPhoneCodePasswordRules(t *testing.T) {
	w := newQAWorld(t)
	device := w.register(t, "+905321110001", "Ayse Yilmaz")
	target, other := "+905551110001", "+905551110002"

	steps := []struct {
		name      string
		advance   time.Duration
		phone     string
		password  string
		status    int
		errorCode apperror.Code
		field     string
	}{
		{"sifresiz baska numara", 0, target, "", http.StatusBadRequest, apperror.CodeValidationFailed, phoneverify.FieldPassword},
		{"yanlis sifre", 0, target, "Yanlis-Parola-2026", http.StatusBadRequest, apperror.CodeValidationFailed, phoneverify.FieldPassword},
		{"dogru sifre", 0, target, qaPassword, http.StatusAccepted, "", ""},
		{"bekleyen varken BASKA numaraya sifresiz", 0, other, "", http.StatusBadRequest, apperror.CodeValidationFailed, phoneverify.FieldPassword},
		{"bekleyen numaraya sifresiz, 60 sn dolmadan", 30 * time.Second, target, "", http.StatusTooManyRequests, apperror.CodeRateLimited, ""},
		{"bekleyen numaraya sifresiz, 60 sn sonra", 31 * time.Second, target, "", http.StatusAccepted, "", ""},
		{"kodun omru (10 dk) dolunca sifresiz", verification.CodeTTL + time.Second, target, "", http.StatusBadRequest, apperror.CodeValidationFailed, phoneverify.FieldPassword},
		{"omur dolunca dogru sifreyle yeniden", 0, target, qaPassword, http.StatusAccepted, "", ""},
	}
	sent := 0
	for _, step := range steps {
		w.clock.Advance(step.advance)
		r := w.phoneCode(t, device, step.phone, step.password)
		if r.status != step.status || r.code() != step.errorCode || (step.field != "" && r.detail(step.field) == nil) {
			t.Fatalf("%s: %d %s %+v bekleniyordu, %d %+v geldi", step.name, step.status, step.errorCode, step.field, r.status, r.body.Error)
		}
		if step.status == http.StatusAccepted {
			sent++
		}
		if w.sms.count() != sent {
			t.Fatalf("%s: SMS sayisi %d, beklenen %d (reddedilen istek SMS gondermez)", step.name, w.sms.count(), sent)
		}
	}

	// Kilit: 5 yanlis kod -> dogru kod da reddedilir. Belgelenen davranis (QA
	// incelemesi "Not"): kilitli kayit hala BEKLEYEN sayilir; 60 sn sonra
	// sifresiz yeniden gonderim yeni kod ve 5 hak verir. Calinmis oturum bu yolla
	// yalnizca kullanicinin sifreyle sectigi numarayi dogrulayabilir.
	for attempt := 0; attempt < verification.MaxAttempts; attempt++ {
		if r := w.phoneVerify(t, device, target, "000000"); r.status != http.StatusBadRequest || r.detail(verification.FieldCode) == nil {
			t.Fatalf("yanlis kod %d: %d %+v", attempt+1, r.status, r.body.Error)
		}
	}
	if r := w.phoneVerify(t, device, target, "481516"); r.status != http.StatusBadRequest || r.detail(verification.FieldCode) == nil {
		t.Fatalf("kilitten sonra dogru kod da reddedilmeli: %d %+v", r.status, r.body.Error)
	}
	w.clock.Advance(verification.ResendAfter + time.Second)
	w.setPhoneCode("777888")
	if r := w.phoneCode(t, device, target, ""); r.status != http.StatusAccepted {
		t.Fatalf("kilitli kayitta sifresiz yeniden gonderim (belgelenen): %d %+v", r.status, r.body.Error)
	}
	if r := w.phoneVerify(t, device, target, "777888"); r.status != http.StatusOK || !qaData[auth.Profile](t, r).PhoneVerified {
		t.Fatalf("yeni kodla dogrulama: %d %+v", r.status, r.body.Error)
	}
}

// 2. Sahiplik sizmaz: 409 yalnizca dogru sifreyle.
func TestQAPhoneOwnerIsRevealedOnlyWithThePassword(t *testing.T) {
	w := newQAWorld(t)
	device := w.register(t, "+905321110011", "Ayse Yilmaz")
	taken := "+905321110012"
	w.register(t, taken, "Baska Kisi")

	for _, password := range []string{"", "Yanlis-Parola-2026"} {
		r := w.phoneCode(t, device, taken, password)
		if r.status != http.StatusBadRequest || r.code() != apperror.CodeValidationFailed || r.detail(phoneverify.FieldPassword) == nil || r.detail(phoneverify.FieldPhone) != nil {
			t.Errorf("sifre %q: yalnizca {password} hatasi beklenirdi (sahip sizmamali): %d %+v", password, r.status, r.body.Error)
		}
	}
	if r := w.phoneVerify(t, device, taken, "481516"); r.status != http.StatusBadRequest || r.code() == apperror.CodePhoneAlreadyRegistered {
		t.Errorf("bekleyen kod yokken dogrulama 409 vermemeli: %d %+v", r.status, r.body.Error)
	}
	r := w.phoneCode(t, device, taken, qaPassword)
	if r.status != http.StatusConflict || r.code() != apperror.CodePhoneAlreadyRegistered || r.detail(phoneverify.FieldPhone) == nil {
		t.Errorf("dogru sifreyle 409 PHONE_ALREADY_REGISTERED {phone}: %d %+v", r.status, r.body.Error)
	}
	if w.sms.count() != 0 {
		t.Errorf("hicbir SMS gitmemeli: %d", w.sms.count())
	}
}

// 4. Oturumlar ve erisim jetonu (G1 (a)).
func TestQAPhoneChangeSessionsAndAccessTokens(t *testing.T) {
	w := newQAWorld(t)
	oldPhone, newPhone := "+905321110021", "+905551110021"
	first := w.register(t, oldPhone, "Ayse Yilmaz")
	_, second := w.login(t, oldPhone)
	_, third := w.login(t, oldPhone)

	if r := w.phoneCode(t, first, newPhone, qaPassword); r.status != http.StatusAccepted {
		t.Fatalf("kod: %d %+v", r.status, r.body.Error)
	}
	if r := w.phoneVerify(t, first, newPhone, "481516"); r.status != http.StatusOK {
		t.Fatalf("dogrulama: %d %+v", r.status, r.body.Error)
	}

	for name, device := range map[string]qaDevice{"ikinci": second, "ucuncu": third} {
		if r := w.refresh(t, device); r.status != http.StatusUnauthorized {
			t.Errorf("%s cihazin yenilemesi 401 olmali: %d", name, r.status)
		}
		// G1 (a): erisim jetonu durumsuz; en gec JWT_TTL icinde biter (ADR-12 Ek 2).
		if r := w.me(t, device); r.status != http.StatusOK {
			t.Errorf("%s cihazin erisim jetonu JWT_TTL dolana kadar gecer (belgelenen): %d", name, r.status)
		}
	}
	if r := w.refresh(t, first); r.status != http.StatusOK {
		t.Errorf("bu oturumun yenilemesi surmeli: %d %+v", r.status, r.body.Error)
	}
	if r, _ := w.login(t, oldPhone); r.status != http.StatusUnauthorized || r.code() != apperror.CodeInvalidCredentials {
		t.Errorf("eski numarayla giris 401 INVALID_CREDENTIALS: %d %+v", r.status, r.body.Error)
	}
	if r, _ := w.login(t, newPhone); r.status != http.StatusOK {
		t.Errorf("yeni numarayla giris: %d %+v", r.status, r.body.Error)
	}
	w.clock.Advance(qaAccessTTL + time.Second)
	if r := w.me(t, second); r.status != http.StatusUnauthorized {
		t.Errorf("JWT_TTL dolunca diger cihazin erisim jetonu 401: %d", r.status)
	}
}

// 4b. Ayni (simdiki, dogrulanmamis) numarayi dogrulamak oturumlara dokunmaz.
func TestQAVerifyingTheCurrentPhoneKeepsSessions(t *testing.T) {
	w := newQAWorld(t)
	phone := "+905321110031"
	first := w.register(t, phone, "Ayse Yilmaz")
	_, second := w.login(t, phone)

	if r := w.phoneCode(t, first, phone, ""); r.status != http.StatusAccepted {
		t.Fatalf("simdiki numaraya sifresiz kod: %d %+v", r.status, r.body.Error)
	}
	if r := w.phoneVerify(t, first, phone, "481516"); r.status != http.StatusOK || !qaData[auth.Profile](t, r).PhoneVerified {
		t.Fatalf("dogrulama: %d %+v", r.status, r.body.Error)
	}
	if r := w.refresh(t, second); r.status != http.StatusOK {
		t.Errorf("ayni numara dogrulamasi diger oturumu kapatmamali: %d", r.status)
	}
	if r := w.phoneCode(t, first, phone, ""); r.status != http.StatusBadRequest || r.detail(phoneverify.FieldPhone) == nil {
		t.Errorf("dogrulanmis numaraya yeniden kod 400 {phone}: %d %+v", r.status, r.body.Error)
	}
}

// 5. PATCH /v1/me kurallari.
func TestQAUpdateProfileRules(t *testing.T) {
	w := newQAWorld(t)
	device := w.register(t, "+905321110041", "Ayse Yilmaz")
	patch := func(key, body string) qaReply {
		return w.do(t, qaCall{method: http.MethodPatch, path: "/v1/me", auth: device.access, key: key, body: body})
	}
	nameOf := func(name string) string { return qaJSON(t, map[string]string{"fullName": name}) }

	cases := []struct {
		name   string
		body   string
		status int
		stored string
	}{
		{"2 karakter", nameOf("Al"), http.StatusOK, "Al"},
		{"80 karakter", nameOf(strings.Repeat("ş", 80)), http.StatusOK, strings.Repeat("ş", 80)},
		{"kirpilinca 80", nameOf("  " + strings.Repeat("a", 80) + "  "), http.StatusOK, strings.Repeat("a", 80)},
		{"81 karakter", nameOf(strings.Repeat("a", 81)), http.StatusBadRequest, ""},
		{"yalniz bosluk", nameOf("   "), http.StatusBadRequest, ""},
		{"HTML ham saklanir", nameOf(`<img src=x onerror=alert(1)>`), http.StatusOK, `<img src=x onerror=alert(1)>`},
		{"phoneVerified alani", `{"fullName":"Ali Veli","phoneVerified":true}`, http.StatusBadRequest, ""},
		{"id alani", `{"fullName":"Ali Veli","id":"usr_0123456789abcdef0123456789abcdef"}`, http.StatusBadRequest, ""},
		{"email alani", `{"fullName":"Ali Veli","email":"ali@example.com"}`, http.StatusBadRequest, ""},
	}
	for _, tc := range cases {
		r := patch(qaKey("profil"), tc.body)
		if r.status != tc.status {
			t.Errorf("%s: %d bekleniyordu, %d %+v", tc.name, tc.status, r.status, r.body.Error)
			continue
		}
		if tc.status == http.StatusOK {
			if got := qaData[auth.Profile](t, w.me(t, device)).FullName; got != tc.stored {
				t.Errorf("%s: GET /v1/me adi %q, beklenen %q", tc.name, got, tc.stored)
			}
		}
	}
	if profile := qaData[auth.Profile](t, w.me(t, device)); profile.Phone != "+905321110041" || profile.PhoneVerified {
		t.Errorf("reddedilen alanlar numaraya dokunmamali: %+v", profile)
	}

	// Tekrar korumasi: ayni anahtar + ayni govde ayni cevap (tekrar basligi),
	// ayni anahtar + farkli govde 409.
	key := qaKey("profil")
	first := patch(key, nameOf("Ayse Kaya"))
	again := patch(key, nameOf("Ayse Kaya"))
	if first.status != http.StatusOK || again.status != http.StatusOK || again.header.Get(httpapi.IdempotentReplayedHeader) == "" {
		t.Errorf("ayni anahtar tekrari: %d %d %q", first.status, again.status, again.header.Get(httpapi.IdempotentReplayedHeader))
	}
	if r := patch(key, nameOf("Baska Ad")); r.status != http.StatusConflict {
		t.Errorf("ayni anahtar farkli govde 409: %d %+v", r.status, r.body.Error)
	}
	if got := qaData[auth.Profile](t, w.me(t, device)).FullName; got != "Ayse Kaya" {
		t.Errorf("409 sonrasi ad degismemeli: %q", got)
	}
}

// 6. Gunluk: kod, numara, sifre, ad ve e-posta hicbir satirda yok.
func TestQAProfileFlowLogsNoSecrets(t *testing.T) {
	w := newQAWorld(t)
	oldPhone, newPhone := "+905321110051", "+905551110051"
	oldName, newName := "Gizlikalmali Birinci", "Gizlikalmali Ikinci"
	email := "gizli.adres@example.com"
	w.setPhoneCode("913577")
	w.setEmailCode("642086")

	first := w.register(t, oldPhone, oldName)
	_, second := w.login(t, oldPhone)
	w.login(t, oldPhone)
	w.do(t, qaCall{method: http.MethodPost, path: "/v1/auth/login", body: qaJSON(t, map[string]string{"phone": oldPhone, "password": "Yanlis-Parola-2026"})})
	w.do(t, qaCall{method: http.MethodPatch, path: "/v1/me", auth: first.access, key: qaKey("profil"), body: qaJSON(t, map[string]string{"fullName": newName})})
	w.phoneCode(t, first, newPhone, "Yanlis-Parola-2026")
	w.phoneCode(t, first, newPhone, qaPassword)
	w.phoneVerify(t, first, newPhone, "135799")
	if r := w.phoneVerify(t, first, newPhone, "913577"); r.status != http.StatusOK {
		t.Fatalf("akis tamamlanmali: %d %+v", r.status, r.body.Error)
	}
	w.refresh(t, second)
	w.do(t, qaCall{method: http.MethodPost, path: "/v1/me/email/code", auth: first.access, key: qaKey("eposta"), body: qaJSON(t, map[string]string{"email": email})})
	w.do(t, qaCall{method: http.MethodPost, path: "/v1/me/email/verify", auth: first.access, key: qaKey("eposta"), body: qaJSON(t, map[string]string{"email": email, "code": "111111"})})
	if r := w.do(t, qaCall{method: http.MethodPost, path: "/v1/me/email/verify", auth: first.access, key: qaKey("eposta"), body: qaJSON(t, map[string]string{"email": email, "code": "642086"})}); r.status != http.StatusOK {
		t.Fatalf("e-posta dogrulamasi: %d %+v", r.status, r.body.Error)
	}

	logs := w.logs.String()
	if strings.Count(logs, "\n") < 10 {
		t.Fatalf("gunluk bos gorunuyor (kaydedici bagli mi?): %q", logs)
	}
	secrets := []string{
		qaPassword, "Yanlis-Parola-2026",
		oldPhone, newPhone, strings.TrimPrefix(oldPhone, "+90"), strings.TrimPrefix(newPhone, "+90"),
		oldName, newName, "Gizlikalmali",
		"913577", "135799", "642086", "111111",
		email, "gizli.adres",
	}
	for _, secret := range secrets {
		if strings.Contains(logs, secret) {
			t.Errorf("gunlukte %q var", secret)
		}
	}
}
