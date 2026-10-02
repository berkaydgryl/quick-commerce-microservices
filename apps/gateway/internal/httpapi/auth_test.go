package httpapi

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"golang.org/x/crypto/bcrypt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// Kimlik uclarinin HTTP testleri GERCEK servisle (bellek depolari, en dusuk
// bcrypt maliyeti) kurulur: uclarin sozlesmesi (durum kodu, zarf, basliklar)
// servisin gercek hatalariyla birlikte sinanir. Servisin kendi kurallari
// auth paketinde, Mongo depolari authstore'un entegrasyon testinde sinanir.

const (
	testPhone    = "+905321234567"
	testPassword = "Gizli-Parola-2026"
	testFullName = "Ayse Yilmaz"
	testRefresh  = 14 * 24 * time.Hour
)

func authApp(t *testing.T, logger *slog.Logger) *fiber.App {
	t.Helper()
	return authAppWith(t, logger, false)
}

// authAppWith, cerezlerin Secure ayariyla (production) kimlik uygulamasi.
func authAppWith(t *testing.T, logger *slog.Logger, secureCookies bool) *fiber.App {
	t.Helper()
	passwords, err := auth.NewPasswordHasher(bcrypt.MinCost)
	if err != nil {
		t.Fatalf("sifre ozetleyici kurulamadi: %v", err)
	}
	service := auth.NewService(auth.Deps{
		Users:      authstore.NewMemoryUsers(),
		Sessions:   authstore.NewMemorySessions(),
		Passwords:  passwords,
		Tokens:     testTokens(),
		RefreshTTL: testRefresh,
		Now:        time.Now,
	})
	return New(Deps{
		Health:            fakeReporter{report: healthyReport()},
		UserRegistrar:     service,
		UserAuthenticator: service,
		PhoneChecker:      service,
		SessionRefresher:  service,
		SessionRevoker:    service,
		ProfileGetter:     service,
		AccessTokens:      testTokens(),
		Idempotency:       testIdempotency(),
		SecureCookies:     secureCookies,
		Logger:            logger,
	})
}

// jsonRequest, JSON govdeli istek; headers bos degerle basligi siler.
func jsonRequest(t *testing.T, method, path, body string, headers map[string]string) *http.Request {
	t.Helper()
	request := newRequest(t, method, path, strings.NewReader(body))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	for name, value := range headers {
		if value == "" {
			request.Header.Del(name)
			continue
		}
		request.Header.Set(name, value)
	}
	return request
}

// registerRequest, anahtarli kayit istegi. Her cagri YENI anahtar kullanir: ayni
// anahtarla farkli govde tekrar korumasinda 409 CONFLICT'tir (T8.2).
func registerRequest(t *testing.T, body string) *http.Request {
	t.Helper()
	key := "kayit-" + hex.EncodeToString(ids.RandomBytes(8))
	return jsonRequest(t, http.MethodPost, "/v1/auth/register", body, map[string]string{IdempotencyKeyHeader: key})
}

func registerBodyOf(phone, password, fullName string) string {
	return marshal(map[string]string{"phone": phone, "password": password, "fullName": fullName})
}

func loginBodyOf(phone, password string) string {
	return marshal(map[string]string{"phone": phone, "password": password})
}

// responseCookie, cevaptaki adi verilen cerez; yoksa testi durdurur.
func responseCookie(t *testing.T, header http.Header, name string) *http.Cookie {
	t.Helper()
	for _, line := range header.Values(fiber.HeaderSetCookie) {
		cookie, err := http.ParseSetCookie(line)
		if err != nil {
			t.Fatalf("Set-Cookie cozulemedi (%q): %v", line, err)
		}
		if cookie.Name == name {
			return cookie
		}
	}
	t.Fatalf("%s cerezi yazilmadi: %v", name, header.Values(fiber.HeaderSetCookie))
	return nil
}

// refreshTokenOf, cevaptaki yenileme cerezinin degeri (jeton).
func refreshTokenOf(t *testing.T, header http.Header) string {
	t.Helper()
	return responseCookie(t, header, RefreshCookie).Value
}

// withRefresh, istege yenileme cerezini ekler (tarayicinin yaptigi gibi).
func withRefresh(request *http.Request, token string) *http.Request {
	request.AddCookie(&http.Cookie{Name: RefreshCookie, Value: token})
	return request
}

// authPost, govdesiz kimlik istegi (yenileme, cikis).
func authPost(t *testing.T, path string) *http.Request {
	t.Helper()
	return jsonRequest(t, http.MethodPost, path, "", nil)
}

func marshal(value map[string]string) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

// dataOf, basarili zarfin verisini hedef tipe cevirir.
func dataOf[T any](t *testing.T, envelope Envelope) T {
	t.Helper()
	var out T
	if !envelope.Success {
		t.Fatalf("basarili zarf bekleniyordu: %+v", envelope.Error)
	}
	raw, err := json.Marshal(envelope.Data)
	if err != nil {
		t.Fatalf("veri kodlanamadi: %v", err)
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("veri cozulemedi: %v", err)
	}
	return out
}

// exchange, istegi gonderir; durum, basliklar ve zarf doner. Govde decode'da
// kapanir (cevap baska bir yardimciya tasinsaydi bodyclose onu goremezdi).
func exchange(t *testing.T, app *fiber.App, request *http.Request) (int, http.Header, Envelope) {
	t.Helper()
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	return response.StatusCode, response.Header, decode(t, response)
}

func TestAuthFlowRegisterLoginMeRefreshLogout(t *testing.T) {
	app := authApp(t, silentLogger())

	// Kayit: 201, jeton cifti, kirpilmis ad; cevap onbelleklenmez.
	status, header, envelope := exchange(t, app, registerRequest(t, registerBodyOf(testPhone, testPassword, "  "+testFullName+"  ")))
	if status != http.StatusCreated || header.Get(fiber.HeaderCacheControl) != noStore {
		t.Fatalf("kayit 201 ve no-store donmeli: %d %q %+v", status, header.Get(fiber.HeaderCacheControl), envelope)
	}
	registered := dataOf[auth.Grant](t, envelope)
	registeredToken := refreshTokenOf(t, header)
	if registered.TokenType != bearerScheme || registered.ExpiresIn != int64(time.Hour/time.Second) ||
		registered.RefreshExpiresIn != int64(testRefresh/time.Second) || registered.AccessToken == "" || registeredToken == "" {
		t.Errorf("erisim jetonu, cerezde yenileme jetonu ve omurler bekleniyordu: %+v", registered)
	}
	if user := registered.User; !ids.Valid(ids.User, user.ID) || user.Phone != testPhone || user.FullName != testFullName {
		t.Errorf("profil yanlis (ad kirpilmali, kimlik usr_ bicimli): %+v", user)
	}

	// Giris: 200, yeni oturum.
	status, header, envelope = exchange(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/login", loginBodyOf(testPhone, testPassword), nil))
	if status != http.StatusOK || header.Get(fiber.HeaderCacheControl) != noStore {
		t.Fatalf("giris 200 ve no-store donmeli: %d %+v", status, envelope)
	}
	loggedIn := dataOf[auth.Grant](t, envelope)
	loggedInToken := refreshTokenOf(t, header)
	if loggedIn.User != registered.User || loggedInToken == registeredToken {
		t.Errorf("giris ayni kullaniciya YENI bir oturum acmali: %+v", loggedIn)
	}

	// Profil: erisim jetonuyla.
	status, envelope = send(t, app, jsonRequest(t, http.MethodGet, "/v1/me", "", map[string]string{fiber.HeaderAuthorization: bearerScheme + " " + loggedIn.AccessToken}))
	if status != http.StatusOK {
		t.Fatalf("/v1/me 200 donmeli: %d %+v", status, envelope)
	}
	if profile := dataOf[auth.Profile](t, envelope); profile != registered.User {
		t.Errorf("profil kayittakiyle ayni olmali: %+v", profile)
	}

	// Yenileme (cerezle): jeton degisir ve cereze yazilir; eskisi bir daha
	// gecmez, olu jetonun cerezi silinir.
	status, header, envelope = exchange(t, app, withRefresh(authPost(t, "/v1/auth/refresh"), loggedInToken))
	if status != http.StatusOK || header.Get(fiber.HeaderCacheControl) != noStore {
		t.Fatalf("yenileme 200 ve no-store donmeli: %d %+v", status, envelope)
	}
	refreshed := dataOf[auth.Grant](t, envelope)
	refreshedToken := refreshTokenOf(t, header)
	if refreshedToken == loggedInToken || refreshed.User != registered.User || refreshed.AccessToken == "" {
		t.Errorf("yenileme yeni jeton vermeli: %+v", refreshed)
	}
	status, header, envelope = exchange(t, app, withRefresh(authPost(t, "/v1/auth/refresh"), loggedInToken))
	if status != http.StatusUnauthorized || detailsOf(t, envelope)[RefreshCookie] == nil {
		t.Errorf("kullanilmis jeton 401 ve %s ayrintisiyla donmeli: %d %+v", RefreshCookie, status, envelope)
	}
	if cleared := responseCookie(t, header, RefreshCookie); cleared.MaxAge >= 0 || cleared.Value != "" {
		t.Errorf("kullanilamayan jetonun cerezi silinmeli: %+v", cleared)
	}

	// Cikis: ilk cagri iptal eder, ikincisi zararsizdir; ikisi de cerezi siler.
	for attempt, want := range []bool{true, false} {
		status, header, envelope = exchange(t, app, withRefresh(authPost(t, "/v1/auth/logout"), refreshedToken))
		if status != http.StatusOK || dataOf[logoutResult](t, envelope).Revoked != want {
			t.Errorf("cikis %d. cagri: 200 ve revoked=%v bekleniyordu: %d %+v", attempt+1, want, status, envelope)
		}
		if cleared := responseCookie(t, header, RefreshCookie); cleared.MaxAge >= 0 {
			t.Errorf("cikis %d. cagri cerezi silmeli: %+v", attempt+1, cleared)
		}
	}
	status, _ = send(t, app, withRefresh(authPost(t, "/v1/auth/refresh"), refreshedToken))
	if status != http.StatusUnauthorized {
		t.Errorf("cikistan sonra yenileme 401 donmeli: %d", status)
	}
}

func TestRefreshTokenTravelsOnlyInHTTPOnlyCookie(t *testing.T) {
	// Yenileme jetonu govdeye girmez: sayfadaki betik (XSS) onu goremez.
	// Cerez HttpOnly, SameSite=Strict, yalnizca /v1/auth yoluna gider; omru
	// REFRESH_TTL. Secure yalnizca production'da.
	for name, secure := range map[string]bool{"gelistirme": false, "production": true} {
		app := authAppWith(t, silentLogger(), secure)

		status, header, body := exchangeRaw(t, app, registerRequest(t, registerBodyOf(testPhone, testPassword, testFullName)))

		if status != http.StatusCreated || strings.Contains(string(body), "refreshToken") {
			t.Errorf("%s: kayit 201 donmeli ve govdede refreshToken olmamali: %d %s", name, status, body)
		}
		cookie := responseCookie(t, header, RefreshCookie)
		if cookie.Value == "" || !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/v1/auth" ||
			cookie.MaxAge != int(testRefresh/time.Second) || cookie.Secure != secure {
			t.Errorf("%s: HttpOnly, Strict, /v1/auth, REFRESH_TTL ve Secure=%v bekleniyordu: %+v", name, secure, cookie)
		}
	}
}

func TestRegisterReturnsOnlyProfileFields(t *testing.T) {
	// Profil tipi sifre ozetini tasimaz; bu test JSON'da da fazladan alan
	// olmadigini (ornek passwordHash) dogrular.
	app := authApp(t, silentLogger())

	_, envelope := send(t, app, registerRequest(t, registerBodyOf(testPhone, testPassword, testFullName)))

	data, isMap := envelope.Data.(map[string]any)
	if !isMap {
		t.Fatalf("veri nesne olmali: %+v", envelope)
	}
	user, isMap := data["user"].(map[string]any)
	if !isMap {
		t.Fatalf("user nesne olmali: %+v", data)
	}
	fields := make([]string, 0, len(user))
	for field := range user {
		fields = append(fields, field)
	}
	slices.Sort(fields)
	if !slices.Equal(fields, []string{"fullName", "id", "phone"}) {
		t.Errorf("profil yalnizca id, phone, fullName tasimali: %v", fields)
	}
}

func TestRegisterRejectsTakenPhone(t *testing.T) {
	app := authApp(t, silentLogger())
	send(t, app, registerRequest(t, registerBodyOf(testPhone, testPassword, testFullName)))

	status, envelope := send(t, app, registerRequest(t, registerBodyOf(testPhone, "Baska-Parola-2026", "Baska Kisi")))

	if status != http.StatusConflict || envelope.Error.Code != apperror.CodePhoneAlreadyRegistered || detailsOf(t, envelope)["phone"] == nil {
		t.Errorf("409 PHONE_ALREADY_REGISTERED ve phone ayrintisi bekleniyordu: %d %+v", status, envelope)
	}
}

func TestRegisterCollectsEveryFormatErrorAtOnce(t *testing.T) {
	app := authApp(t, silentLogger())
	request := jsonRequest(t, http.MethodPost, "/v1/auth/register", registerBodyOf("05321234567", "kisa", " "), nil)

	status, envelope := send(t, app, request)

	details := detailsOf(t, envelope)
	for _, field := range []string{IdempotencyKeyHeader, auth.FieldPhone, auth.FieldPassword, auth.FieldFullName} {
		if details[field] == nil {
			t.Errorf("%s ayrintisi bekleniyordu: %+v", field, details)
		}
	}
	if status != http.StatusBadRequest || envelope.Error.Code != apperror.CodeValidationFailed {
		t.Errorf("400 VALIDATION_FAILED bekleniyordu: %d %+v", status, envelope)
	}
}

func TestRegisterRejectsUnknownField(t *testing.T) {
	// E-posta toplanmaz (ADR-12): sessizce yok sayilsaydi istemci kaydedildigini sanirdi.
	app := authApp(t, silentLogger())
	body := `{"phone":"` + testPhone + `","password":"` + testPassword + `","fullName":"` + testFullName + `","email":"a@b.c"}`

	status, envelope := send(t, app, registerRequest(t, body))

	if status != http.StatusBadRequest || detailsOf(t, envelope)["email"] != unknownFieldReason {
		t.Errorf("bilinmeyen alan 400 donmeli: %d %+v", status, envelope)
	}
}

func TestLoginFailuresAreIndistinguishable(t *testing.T) {
	// Yanlis sifre ile kayitsiz numara AYNI cevabi almali: aksi halde kayitli
	// numaralar giris ucundan taranabilirdi.
	app := authApp(t, silentLogger())
	send(t, app, registerRequest(t, registerBodyOf(testPhone, testPassword, testFullName)))

	wrongStatus, wrong := send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/login", loginBodyOf(testPhone, "Yanlis-Parola-2026"), nil))
	unknownStatus, unknown := send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/login", loginBodyOf("+905559876543", testPassword), nil))

	if wrongStatus != http.StatusUnauthorized || wrong.Error.Code != apperror.CodeInvalidCredentials {
		t.Fatalf("yanlis sifre 401 INVALID_CREDENTIALS donmeli: %d %+v", wrongStatus, wrong)
	}
	wrong.Error.RequestID, unknown.Error.RequestID = "", ""
	if unknownStatus != wrongStatus || !reflect.DeepEqual(unknown.Error, wrong.Error) {
		t.Errorf("iki cevap ayni olmali:\nyanlis sifre: %d %+v\nkayitsiz no : %d %+v", wrongStatus, wrong.Error, unknownStatus, unknown.Error)
	}
}

func TestLoginValidatesFormatWithoutIdempotencyKey(t *testing.T) {
	app := authApp(t, silentLogger())

	status, envelope := send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/login", loginBodyOf("5321234567", testPassword), nil))

	details := detailsOf(t, envelope)
	if status != http.StatusBadRequest || details[auth.FieldPhone] == nil {
		t.Errorf("bicimsiz telefon 400 donmeli: %d %+v", status, envelope)
	}
	if details[IdempotencyKeyHeader] != nil {
		t.Errorf("giris Idempotency-Key istememeli: %+v", details)
	}
}

func TestRefreshWithoutCookieIsUnauthorized(t *testing.T) {
	// Cerezsiz yenileme oturumu olmayan istektir (401): istemci girise
	// yonlenir. Govdedeki eski bicim ({"refreshToken": ...}) okunmaz.
	app := authApp(t, silentLogger())
	_, registeredEnvelope := send(t, app, registerRequest(t, registerBodyOf(testPhone, testPassword, testFullName)))
	dataOf[auth.Grant](t, registeredEnvelope)

	for name, request := range map[string]*http.Request{
		"cerez yok":            authPost(t, "/v1/auth/refresh"),
		"bos cerez":            withRefresh(authPost(t, "/v1/auth/refresh"), "   "),
		"jeton govdede (eski)": jsonRequest(t, http.MethodPost, "/v1/auth/refresh", `{"refreshToken":"herhangi"}`, nil),
	} {
		status, envelope := send(t, app, request)
		if status != http.StatusUnauthorized || envelope.Error.Code != apperror.CodeUnauthorized || detailsOf(t, envelope)[RefreshCookie] != requiredReason {
			t.Errorf("%s: 401 ve %s zorunlu bekleniyordu: %d %+v", name, RefreshCookie, status, envelope)
		}
	}
}

func TestLogoutWithoutCookieIsHarmless(t *testing.T) {
	// Cikisin tekrari zararsizdir: cerezsiz cagri revoked:false alir ve cerez
	// yine silinir (tarayicida kalmis olabilir).
	app := authApp(t, silentLogger())

	status, header, envelope := exchange(t, app, authPost(t, "/v1/auth/logout"))

	if status != http.StatusOK || dataOf[logoutResult](t, envelope).Revoked {
		t.Errorf("cerezsiz cikis 200 ve revoked=false donmeli: %d %+v", status, envelope)
	}
	if cleared := responseCookie(t, header, RefreshCookie); cleared.MaxAge >= 0 || cleared.Path != "/v1/auth" {
		t.Errorf("cerez ayni yolla silinmeli: %+v", cleared)
	}
}

func TestSecretsStayOutOfLog(t *testing.T) {
	var logs bytes.Buffer
	app := authApp(t, slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))

	_, header, _ := exchange(t, app, registerRequest(t, registerBodyOf(testPhone, testPassword, testFullName)))
	token := refreshTokenOf(t, header)
	send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/login", loginBodyOf(testPhone, testPassword+"-yanlis"), nil))
	send(t, app, withRefresh(authPost(t, "/v1/auth/refresh"), token))
	send(t, app, withRefresh(authPost(t, "/v1/auth/refresh"), token))

	if !strings.Contains(logs.String(), string(apperror.CodeInvalidCredentials)) {
		t.Fatalf("hatali giris gunluge dusmeliydi: %s", logs.String())
	}
	for name, secret := range map[string]string{"sifre": testPassword, "yenileme jetonu": token} {
		if strings.Contains(logs.String(), secret) {
			t.Errorf("%s gunluge sizdi: %s", name, logs.String())
		}
	}
}
