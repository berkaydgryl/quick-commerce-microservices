package main

// QA kara kutu (T11.14 PR 3, #122; QA incelemesi 8): telefon degistirme
// uclari production'da HIC baglanmaz (gercek SMS saglayicisi yok, #95).
// Backend parcalari ayri sinar (buildPhoneVerification nil doner; httpapi
// servis yoksa rotayi baglamaz); burada ortamdan acilisa butun zincir:
// config.Load -> bootstrap -> yonlendirici. MOCK: Mongo/Redis gerekmez,
// kararin dayandigi tek sey NODE_ENV.

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/telemetry"
)

func qaEnv(nodeEnv string) config.Getenv {
	values := map[string]string{
		"NODE_ENV":              nodeEnv,
		"MOCK":                  "true",
		"JWT_SECRET":            "qa-production-testi-icin-uzun-bir-imza-sirri-0123456789",
		"REALTIME_TOKEN_SECRET": "qa-production-testi-icin-ayri-oda-jetonu-sirri-0123456789",
		"RATE_LIMIT_ENABLED":    "false",
		"ASSET_BASE_URL":        "http://localhost:5173",
	}
	return func(name string) string { return values[name] }
}

// qaGateway, ortamdan acilan gateway (bootstrap); kapanis teste baglidir.
func qaGateway(t *testing.T, nodeEnv string) *fiber.App {
	t.Helper()
	cfg, err := config.Load(qaEnv(nodeEnv))
	if err != nil {
		t.Fatalf("%s ortami yuklenemedi: %v", nodeEnv, err)
	}
	tracing, err := telemetry.Setup(t.Context(), "")
	if err != nil {
		t.Fatalf("izleme: %v", err)
	}
	app, cleanup, err := bootstrap(t.Context(), cfg, slog.New(slog.NewJSONHandler(io.Discard, nil)), tracing, nil)
	if err != nil {
		t.Fatalf("%s acilisi: %v", nodeEnv, err)
	}
	t.Cleanup(cleanup)
	return app
}

// qaStatus, oturumsuz istegin durumu: rota varsa kimlik ara katmani 401 der,
// yoksa 404.
func qaStatus(t *testing.T, app *fiber.App, method, path string) int {
	t.Helper()
	request := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(`{}`))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("istek: %v", err)
	}
	if err := response.Body.Close(); err != nil {
		t.Errorf("govde kapatilamadi: %v", err)
	}
	return response.StatusCode
}

func TestQAPhoneEndpointsExistOnlyOutsideProduction(t *testing.T) {
	production, development := qaGateway(t, config.EnvProduction), qaGateway(t, config.EnvDevelopment)

	for _, path := range []string{"/v1/me/phone/code", "/v1/me/phone/verify"} {
		if status := qaStatus(t, production, http.MethodPost, path); status != http.StatusNotFound {
			t.Errorf("production %s: 404 bekleniyordu, %d", path, status)
		}
		if status := qaStatus(t, development, http.MethodPost, path); status != http.StatusUnauthorized {
			t.Errorf("development %s: 401 (rota bagli) bekleniyordu, %d", path, status)
		}
	}
	// Ad duzenleme ve e-posta dogrulama production'da da acik.
	for _, route := range []struct{ method, path string }{
		{http.MethodPatch, "/v1/me"},
		{http.MethodPost, "/v1/me/email/code"},
		{http.MethodPost, "/v1/me/email/verify"},
	} {
		if status := qaStatus(t, production, route.method, route.path); status != http.StatusUnauthorized {
			t.Errorf("production %s %s: 401 (rota bagli) bekleniyordu, %d", route.method, route.path, status)
		}
	}
}
