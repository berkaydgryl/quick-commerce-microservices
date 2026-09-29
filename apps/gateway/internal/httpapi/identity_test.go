package httpapi

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// fakeProfiles, /v1/me'nin arkasindaki servisin yerine gecer.
type fakeProfiles struct {
	userID string
	called bool
}

func (f *fakeProfiles) Profile(_ context.Context, userID string) (auth.Profile, error) {
	f.called, f.userID = true, userID
	return auth.Profile{ID: userID, Phone: "+905321234567", FullName: "Test Kullanici"}, nil
}

// protectedApp, korumali uclarin hepsini (siparis + /v1/me) tasiyan uygulama.
func protectedApp(orders *fakeOrders, profiles *fakeProfiles, logger *slog.Logger) *fiber.App {
	return New(Deps{
		Health:           fakeReporter{report: healthyReport()},
		CartReserver:     orders,
		OrderPlacer:      orders,
		ThreeDSConfirmer: orders,
		OrderGetter:      orders,
		ProfileGetter:    profiles,
		AccessTokens:     testTokens(),
		Logger:           logger,
	})
}

// protectedRoutes, erisim jetonu isteyen uclar. T8.1 kabul olcutu: jetonsuz 401.
var protectedRoutes = []struct{ method, path, body string }{
	{http.MethodGet, "/v1/me", ""},
	{http.MethodPost, "/v1/cart/reserve", validReserveBody},
	{http.MethodPost, "/v1/orders", validPlaceBody},
	{http.MethodPost, "/v1/orders/" + testOrderID + "/3ds", `{"challengeId":"tds_1","otp":"123456"}`},
	{http.MethodGet, "/v1/orders/" + testOrderID, ""},
}

func TestProtectedRoutesRequireToken(t *testing.T) {
	for _, route := range protectedRoutes {
		orders, profiles := &fakeOrders{}, &fakeProfiles{}
		app := protectedApp(orders, profiles, silentLogger())

		response, err := app.Test(orderRequest(t, route.method, route.path, route.body, map[string]string{fiber.HeaderAuthorization: ""}))
		if err != nil {
			t.Fatalf("istek basarisiz: %v", err)
		}
		envelope := decode(t, response)

		if response.StatusCode != http.StatusUnauthorized || envelope.Error == nil || envelope.Error.Code != apperror.CodeUnauthorized {
			t.Errorf("%s %s: 401 UNAUTHORIZED bekleniyordu: %d %+v", route.method, route.path, response.StatusCode, envelope)
			continue
		}
		if got := detailsOf(t, envelope)[fiber.HeaderAuthorization]; got != missingTokenReason {
			t.Errorf("%s %s: sebep %q bekleniyordu, %q geldi", route.method, route.path, missingTokenReason, got)
		}
		if got := response.Header.Get(fiber.HeaderWWWAuthenticate); got != bearerChallenge {
			t.Errorf("%s %s: WWW-Authenticate %q bekleniyordu, %q geldi", route.method, route.path, bearerChallenge, got)
		}
		if orders.called || profiles.called {
			t.Errorf("%s %s: jetonsuz istekte servis cagrilmamaliydi", route.method, route.path)
		}
	}
}

func TestInvalidTokensAreRejected(t *testing.T) {
	identity := auth.Identity{UserID: testUserID, SessionID: testSessionID}
	expired := issueWith(t, auth.NewTokens(testSecret, time.Hour, func() time.Time { return time.Now().Add(-2 * time.Hour) }), identity)
	foreign := issueWith(t, auth.NewTokens([]byte("baska-bir-sistemin-imza-sirri-32-bayttan-uzun"), time.Hour, time.Now), identity)
	badSubject := issueWith(t, testTokens(), auth.Identity{UserID: "usr_1", SessionID: testSessionID})

	cases := []struct {
		name, header, reason, challenge string
	}{
		{"baska sema", "Basic dXNlcjpwYXNz", missingTokenReason, bearerChallenge},
		{"jetonsuz sema", bearerScheme, missingTokenReason, bearerChallenge},
		{"bosluk jeton", bearerScheme + "    ", missingTokenReason, bearerChallenge},
		{"bicimsiz jeton", bearerScheme + " bozuk.jeton.degeri", invalidTokenReason, invalidTokenChallenge},
		{"suresi dolmus", bearerScheme + " " + expired, invalidTokenReason, invalidTokenChallenge},
		{"baska sirla imzali", bearerScheme + " " + foreign, invalidTokenReason, invalidTokenChallenge},
		{"kimligi bicim disi", bearerScheme + " " + badSubject, invalidTokenReason, invalidTokenChallenge},
	}
	for _, tc := range cases {
		orders := &fakeOrders{}
		app := protectedApp(orders, &fakeProfiles{}, silentLogger())

		response, err := app.Test(orderRequest(t, http.MethodGet, "/v1/orders/"+testOrderID, "", map[string]string{fiber.HeaderAuthorization: tc.header}))
		if err != nil {
			t.Fatalf("istek basarisiz: %v", err)
		}
		envelope := decode(t, response)

		if response.StatusCode != http.StatusUnauthorized || detailsOf(t, envelope)[fiber.HeaderAuthorization] != tc.reason {
			t.Errorf("%s: 401 ve %q bekleniyordu: %d %+v", tc.name, tc.reason, response.StatusCode, envelope)
		}
		if got := response.Header.Get(fiber.HeaderWWWAuthenticate); got != tc.challenge {
			t.Errorf("%s: WWW-Authenticate %q bekleniyordu, %q geldi", tc.name, tc.challenge, got)
		}
		if orders.called {
			t.Errorf("%s: gecersiz jetonla servis cagrilmamaliydi", tc.name)
		}
	}
}

func TestBearerSchemeIsCaseInsensitive(t *testing.T) {
	// RFC 7235: sema adi buyuk-kucuk harfe duyarsizdir.
	orders := &fakeOrders{}
	app := orderApp(orders)
	header := strings.Replace(bearer(t), bearerScheme, "bearer", 1)

	status, envelope := send(t, app, orderRequest(t, http.MethodGet, "/v1/orders/"+testOrderID, "", map[string]string{fiber.HeaderAuthorization: header}))

	if status != http.StatusOK || orders.getUserID != testUserID {
		t.Errorf("kucuk harfli sema kabul edilmeli ve kimlik tasinmali: %d %q %+v", status, orders.getUserID, envelope)
	}
}

func TestMeReceivesUserFromToken(t *testing.T) {
	profiles := &fakeProfiles{}
	app := protectedApp(&fakeOrders{}, profiles, silentLogger())

	response, err := app.Test(orderRequest(t, http.MethodGet, "/v1/me", "", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	envelope := decode(t, response)

	if response.StatusCode != http.StatusOK || profiles.userID != testUserID {
		t.Fatalf("200 ve jetondaki kullanici bekleniyordu: %d %q %+v", response.StatusCode, profiles.userID, envelope)
	}
	if got := response.Header.Get(fiber.HeaderCacheControl); got != noStore {
		t.Errorf("profil onbelleklenmemeli: Cache-Control %q", got)
	}
}

func TestRejectedTokenStaysOutOfLogAndResponse(t *testing.T) {
	// Jeton bir kimlik belgesidir: gecersiz olsa bile (suresi yeni dolmus,
	// imzasi dogru) gunluge ya da cevaba yazilmamali.
	var logs bytes.Buffer
	app := protectedApp(&fakeOrders{}, &fakeProfiles{}, slog.New(slog.NewJSONHandler(&logs, nil)))
	expired := issueWith(t, auth.NewTokens(testSecret, time.Minute, func() time.Time { return time.Now().Add(-time.Hour) }),
		auth.Identity{UserID: testUserID, SessionID: testSessionID})

	response, err := app.Test(orderRequest(t, http.MethodGet, "/v1/me", "", map[string]string{fiber.HeaderAuthorization: bearerScheme + " " + expired}))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	body, readErr := io.ReadAll(response.Body)
	if closeErr := response.Body.Close(); closeErr != nil {
		t.Errorf("cevap govdesi kapatilamadi: %v", closeErr)
	}
	if readErr != nil {
		t.Fatalf("cevap okunamadi: %v", readErr)
	}

	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("401 bekleniyordu: %d", response.StatusCode)
	}
	if !strings.Contains(logs.String(), "UNAUTHORIZED") {
		t.Fatalf("hata gunluge dusmeliydi: %s", logs.String())
	}
	signature := expired[strings.LastIndex(expired, ".")+1:]
	if strings.Contains(logs.String(), signature) || strings.Contains(string(body), signature) {
		t.Errorf("jeton gunluge ya da cevaba sizdi:\ngunluk: %s\ncevap: %s", logs.String(), body)
	}
}

// issueWith, verilen uretecle jeton uretir.
func issueWith(t *testing.T, tokens *auth.Tokens, identity auth.Identity) string {
	t.Helper()
	token, err := tokens.Issue(identity)
	if err != nil {
		t.Fatalf("jeton uretilemedi: %v", err)
	}
	return token
}
