package httpapi

import (
	"bytes"
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
		SessionRefresher:  service,
		SessionRevoker:    service,
		ProfileGetter:     service,
		AccessTokens:      testTokens(),
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

// registerRequest, anahtarli kayit istegi.
func registerRequest(t *testing.T, body string) *http.Request {
	t.Helper()
	return jsonRequest(t, http.MethodPost, "/v1/auth/register", body, map[string]string{IdempotencyKeyHeader: "kayit-anahtari-0001"})
}

func registerBodyOf(phone, password, fullName string) string {
	return marshal(map[string]string{"phone": phone, "password": password, "fullName": fullName})
}

func loginBodyOf(phone, password string) string {
	return marshal(map[string]string{"phone": phone, "password": password})
}

func refreshBodyOf(token string) string {
	return marshal(map[string]string{"refreshToken": token})
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
	if registered.TokenType != bearerScheme || registered.ExpiresIn != int64(time.Hour/time.Second) ||
		registered.RefreshExpiresIn != int64(testRefresh/time.Second) || registered.AccessToken == "" || registered.RefreshToken == "" {
		t.Errorf("jeton cifti eksik ya da omurler yanlis: %+v", registered)
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
	if loggedIn.User != registered.User || loggedIn.RefreshToken == registered.RefreshToken {
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

	// Yenileme: jeton degisir; eskisi bir daha gecmez.
	status, header, envelope = exchange(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/refresh", refreshBodyOf(loggedIn.RefreshToken), nil))
	if status != http.StatusOK || header.Get(fiber.HeaderCacheControl) != noStore {
		t.Fatalf("yenileme 200 ve no-store donmeli: %d %+v", status, envelope)
	}
	refreshed := dataOf[auth.Grant](t, envelope)
	if refreshed.RefreshToken == loggedIn.RefreshToken || refreshed.User != registered.User {
		t.Errorf("yenileme yeni jeton vermeli: %+v", refreshed)
	}
	status, envelope = send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/refresh", refreshBodyOf(loggedIn.RefreshToken), nil))
	if status != http.StatusUnauthorized || detailsOf(t, envelope)[refreshTokenField] == nil {
		t.Errorf("kullanilmis jeton 401 ve refreshToken ayrintisiyla donmeli: %d %+v", status, envelope)
	}

	// Cikis: ilk cagri iptal eder, ikincisi zararsizdir; iptal edilen jeton yenilenmez.
	for attempt, want := range []bool{true, false} {
		status, envelope = send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/logout", refreshBodyOf(refreshed.RefreshToken), nil))
		if status != http.StatusOK || dataOf[logoutResult](t, envelope).Revoked != want {
			t.Errorf("cikis %d. cagri: 200 ve revoked=%v bekleniyordu: %d %+v", attempt+1, want, status, envelope)
		}
	}
	status, _ = send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/refresh", refreshBodyOf(refreshed.RefreshToken), nil))
	if status != http.StatusUnauthorized {
		t.Errorf("cikistan sonra yenileme 401 donmeli: %d", status)
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

func TestRefreshAndLogoutRequireToken(t *testing.T) {
	app := authApp(t, silentLogger())
	for _, path := range []string{"/v1/auth/refresh", "/v1/auth/logout"} {
		for _, body := range []string{`{}`, `{"refreshToken":"   "}`} {
			status, envelope := send(t, app, jsonRequest(t, http.MethodPost, path, body, nil))

			if status != http.StatusBadRequest || detailsOf(t, envelope)[refreshTokenField] != requiredReason {
				t.Errorf("%s %s: 400 ve refreshToken zorunlu bekleniyordu: %d %+v", path, body, status, envelope)
			}
		}
	}
}

func TestSecretsStayOutOfLog(t *testing.T) {
	var logs bytes.Buffer
	app := authApp(t, slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))

	_, registeredEnvelope := send(t, app, registerRequest(t, registerBodyOf(testPhone, testPassword, testFullName)))
	registered := dataOf[auth.Grant](t, registeredEnvelope)
	send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/login", loginBodyOf(testPhone, testPassword+"-yanlis"), nil))
	send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/refresh", refreshBodyOf(registered.RefreshToken), nil))
	send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/refresh", refreshBodyOf(registered.RefreshToken), nil))

	if !strings.Contains(logs.String(), string(apperror.CodeInvalidCredentials)) {
		t.Fatalf("hatali giris gunluge dusmeliydi: %s", logs.String())
	}
	for name, secret := range map[string]string{"sifre": testPassword, "yenileme jetonu": registered.RefreshToken} {
		if strings.Contains(logs.String(), secret) {
			t.Errorf("%s gunluge sizdi: %s", name, logs.String())
		}
	}
}
