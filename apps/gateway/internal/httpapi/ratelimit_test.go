package httpapi

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"golang.org/x/crypto/bcrypt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ratelimit"
)

// Hiz siniri (T8.2, P2) bellek sayaciyla ve ilerletilebilen saatle sinanir;
// Redis'teki ayni kurallar ratelimit paketinin entegrasyon testinde.

const testWindow = time.Minute

// limitedApp, butun uclari tasiyan ve verilen sinirlarla calisan uygulama.
func limitedApp(t *testing.T, limits RateLimit, orders *fakeOrders, logger *slog.Logger) *fiber.App {
	t.Helper()
	passwords, err := auth.NewPasswordHasher(bcrypt.MinCost)
	if err != nil {
		t.Fatalf("sifre ozetleyici kurulamadi: %v", err)
	}
	service := auth.NewService(auth.Deps{
		Users: authstore.NewMemoryUsers(), Sessions: authstore.NewMemorySessions(), Passwords: passwords,
		Tokens: testTokens(), Locator: auth.NoLocator{}, RefreshTTL: testRefresh, Now: time.Now,
	})
	markets := &fakeCatalog{}
	return New(Deps{
		Health:            fakeReporter{report: healthyReport()},
		Categories:        &fakeLister{list: catalog.CategoryList{Items: []catalog.Category{}}},
		NearbyMarkets:     markets,
		Market:            markets,
		MarketCategories:  markets,
		MarketProducts:    markets,
		CartReserver:      orders,
		OrderPlacer:       orders,
		ThreeDSConfirmer:  orders,
		OrderGetter:       orders,
		UserRegistrar:     service,
		UserAuthenticator: service,
		SessionRefresher:  service,
		SessionRevoker:    service,
		ProfileGetter:     &fakeProfiles{},
		CheckoutSignals:   &fakeSignals{},
		AccessTokens:      testTokens(),
		Idempotency:       testIdempotency(),
		RateLimit:         limits,
		Logger:            logger,
	})
}

// memoryLimits, verilen saatle bellek sayacli sinirlar.
func memoryLimits(clock *testClock, general, authLimit, order int) RateLimit {
	return RateLimit{Limiter: ratelimit.NewMemory(clock.Now), Window: testWindow, General: general, Auth: authLimit, Order: order}
}

func newTestClock() *testClock {
	return &testClock{now: time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)}
}

func getStatus(t *testing.T, app *fiber.App, target string, headers map[string]string) (int, http.Header, Envelope) {
	t.Helper()
	request := newRequest(t, http.MethodGet, target, nil)
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	return exchange(t, app, request)
}

// bearerFor, verilen kullanici icin gecerli Authorization degeri.
func bearerFor(t *testing.T, userID string) map[string]string {
	t.Helper()
	token, err := testTokens().Issue(auth.Identity{UserID: userID, SessionID: testSessionID})
	if err != nil {
		t.Fatalf("test jetonu uretilemedi: %v", err)
	}
	return map[string]string{fiber.HeaderAuthorization: bearerScheme + " " + token}
}

func TestLimitExceededReturns429WithRetryAfter(t *testing.T) {
	clock := newTestClock()
	app := limitedApp(t, memoryLimits(clock, 2, 10, 10), &fakeOrders{}, silentLogger())

	for i := range 2 {
		if status, _, _ := getStatus(t, app, "/v1/categories", nil); status != http.StatusOK {
			t.Fatalf("%d. istek 200 donmeli: %d", i+1, status)
		}
	}
	status, header, envelope := getStatus(t, app, "/v1/categories", nil)

	if status != http.StatusTooManyRequests || envelope.Error.Code != apperror.CodeRateLimited {
		t.Fatalf("429 RATE_LIMITED bekleniyordu: %d %+v", status, envelope)
	}
	if header.Get(fiber.HeaderRetryAfter) != "60" || detailsOf(t, envelope)["retryAfterSeconds"] != float64(60) {
		t.Errorf("Retry-After 60 ve retryAfterSeconds 60 bekleniyordu: %q %+v", header.Get(fiber.HeaderRetryAfter), envelope.Error.Details)
	}

	clock.advance(testWindow + time.Second)
	if status, _, _ := getStatus(t, app, "/v1/categories", nil); status != http.StatusOK {
		t.Errorf("pencere gecince istek kabul edilmeli: %d", status)
	}
}

func TestLimitsAreCountedPerRoute(t *testing.T) {
	clock := newTestClock()
	app := limitedApp(t, memoryLimits(clock, 1, 10, 10), &fakeOrders{}, silentLogger())
	getStatus(t, app, "/v1/categories", nil)

	if status, _, _ := getStatus(t, app, "/v1/categories", nil); status != http.StatusTooManyRequests {
		t.Fatalf("ayni uc sinirda olmali: %d", status)
	}
	if status, _, _ := getStatus(t, app, "/v1/markets?lat=40.99&lng=29.02", nil); status != http.StatusOK {
		t.Errorf("baska uc kendi sayacina sahip olmali: %d", status)
	}
}

func TestAuthEndpointsHaveTheirOwnTighterLimit(t *testing.T) {
	// Giris kaba kuvvete karsi dar sinirda; kataloga dokunmaz. Yanlis sifre
	// (401) de sayilir: sayilmasaydi kaba kuvvet sinirsiz olurdu.
	clock := newTestClock()
	app := limitedApp(t, memoryLimits(clock, 10, 2, 10), &fakeOrders{}, silentLogger())
	login := func() int {
		status, _ := send(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/login", loginBodyOf(testPhone, testPassword), nil))
		return status
	}

	if first, second := login(), login(); first != http.StatusUnauthorized || second != http.StatusUnauthorized {
		t.Fatalf("ilk iki giris sifre yuzunden 401 almali: %d %d", first, second)
	}
	if status := login(); status != http.StatusTooManyRequests {
		t.Errorf("ucuncu giris 429 almali: %d", status)
	}
	if status, _, _ := getStatus(t, app, "/v1/categories", nil); status != http.StatusOK {
		t.Errorf("katalog genel sinirda, etkilenmemeli: %d", status)
	}
}

func TestProtectedEndpointsAreCountedPerUser(t *testing.T) {
	// Ayni IP'den iki kullanici: sayaclar ayri (ayni agin arkasindaki
	// kullanicilar birbirinin sinirini tuketmez).
	clock := newTestClock()
	app := limitedApp(t, memoryLimits(clock, 1, 10, 10), &fakeOrders{}, silentLogger())
	first := bearerFor(t, testUserID)
	second := bearerFor(t, "usr_ffffffffffffffffffffffffffffffff")

	if status, _, _ := getStatus(t, app, "/v1/me", first); status != http.StatusOK {
		t.Fatalf("ilk profil istegi 200 donmeli: %d", status)
	}
	if status, _, _ := getStatus(t, app, "/v1/me", first); status != http.StatusTooManyRequests {
		t.Errorf("ayni kullanici sinirda olmali: %d", status)
	}
	if status, _, _ := getStatus(t, app, "/v1/me", second); status != http.StatusOK {
		t.Errorf("baska kullanici kendi sayacina sahip olmali: %d", status)
	}
}

func TestRateLimitedRequestNeverClaimsItsIdempotencyKey(t *testing.T) {
	// Sinirlayici tekrar korumasindan ONCE calisir: 429 alan istegin anahtari
	// alinmaz ve kaydedilmez; pencere gecince ayni anahtarla istek islenir.
	clock := newTestClock()
	orders := &fakeOrders{}
	app := limitedApp(t, memoryLimits(clock, 10, 10, 1), orders, silentLogger())
	reserve := func(key string) (int, http.Header) {
		status, header, _ := exchange(t, app, orderRequest(t, http.MethodPost, "/v1/cart/reserve", validReserveBody, map[string]string{IdempotencyKeyHeader: key}))
		return status, header
	}

	if status, _ := reserve("anahtar-ilk-0001"); status != http.StatusCreated {
		t.Fatalf("ilk rezervasyon 201 donmeli: %d", status)
	}
	if status, _ := reserve("anahtar-ikinci-01"); status != http.StatusTooManyRequests {
		t.Fatalf("ikinci rezervasyon 429 almali: %d", status)
	}
	// Sira sabit: sinir doluyken bitmis istegin tekrari da 429 alir (tekrar
	// korumasi sinirlayicidan sonra olsaydi kayittan tekrar edilirdi).
	if status, header := reserve("anahtar-ilk-0001"); status != http.StatusTooManyRequests || header.Get(IdempotentReplayedHeader) != "" {
		t.Fatalf("sinir doluyken tekrar da 429 almali: %d tekrar=%q", status, header.Get(IdempotentReplayedHeader))
	}
	clock.advance(testWindow + time.Second)
	status, header := reserve("anahtar-ikinci-01")

	if status != http.StatusCreated || header.Get(IdempotentReplayedHeader) != "" || orders.calls != 2 {
		t.Errorf("429 alan anahtar sonradan yeni istek gibi islenmeli: %d tekrar=%q cagri=%d", status, header.Get(IdempotentReplayedHeader), orders.calls)
	}
}

// failingLimiter, deposuna ulasilamayan sayac.
type failingLimiter struct{}

func (failingLimiter) Allow(context.Context, string, int, time.Duration) (ratelimit.Decision, error) {
	return ratelimit.Decision{}, ratelimit.ErrUnavailable
}

func TestLimiterFailureLetsRequestsThroughAndWarnsOnce(t *testing.T) {
	// Fail-open: Redis'e ulasilamazken istek gecer. Uyari istek basina degil,
	// aralikta bir kez yazilir.
	var out bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&out, nil))
	app := limitedApp(t, RateLimit{Limiter: failingLimiter{}, Window: testWindow, General: 1, Auth: 1, Order: 1}, &fakeOrders{}, logger)

	for i := range 3 {
		if status, _, _ := getStatus(t, app, "/v1/categories", nil); status != http.StatusOK {
			t.Fatalf("%d. istek gecmeli: %d", i+1, status)
		}
	}

	if warnings := strings.Count(out.String(), "hiz siniri uygulanamadi"); warnings != 1 {
		t.Errorf("tek uyari bekleniyordu, %d yazildi", warnings)
	}
}

// stallingLimiter, cevap vermeyen (takilan) sayac: baglam bitene kadar bekler.
type stallingLimiter struct{ deadline chan time.Duration }

func (s stallingLimiter) Allow(ctx context.Context, _ string, _ int, _ time.Duration) (ratelimit.Decision, error) {
	if deadline, ok := ctx.Deadline(); ok {
		s.deadline <- time.Until(deadline)
	} else {
		s.deadline <- 0
	}
	<-ctx.Done()
	return ratelimit.Decision{}, ctx.Err()
}

func TestStalledLimiterDelaysRequestOnlyBriefly(t *testing.T) {
	// Redis takilirsa sayac kisa son tarihle sorulur ve istek gecer; istek
	// suresinin tamami (GATEWAY_REQUEST_TIMEOUT_MS) beklenmez.
	limiter := stallingLimiter{deadline: make(chan time.Duration, 1)}
	app := limitedApp(t, RateLimit{Limiter: limiter, Window: testWindow, General: 1, Auth: 1, Order: 1}, &fakeOrders{}, silentLogger())
	startedAt := time.Now()

	status, _, _ := getStatus(t, app, "/v1/categories", nil)

	if status != http.StatusOK {
		t.Errorf("takilan sayacta istek gecmeli: %d", status)
	}
	if given := <-limiter.deadline; given <= 0 || given > rateLimitCallTimeout {
		t.Errorf("sayaca en fazla %v son tarih verilmeli: %v", rateLimitCallTimeout, given)
	}
	if elapsed := time.Since(startedAt); elapsed > 2*time.Second {
		t.Errorf("istek kisa surede donmeli, %v surdu", elapsed)
	}
}

func TestFailOpenWarningRepeatsAfterItsInterval(t *testing.T) {
	var out bytes.Buffer
	clock := newTestClock()
	warning := &failOpenWarning{logger: slog.New(slog.NewJSONHandler(&out, nil)), now: clock.Now}
	app := fiber.New()
	app.Get("/", func(c fiber.Ctx) error {
		warning.warn(c, errors.New("redis yok"))
		return c.SendStatus(http.StatusNoContent)
	})
	hit := func() {
		if err := hitRoot(app); err != nil {
			t.Fatalf("istek basarisiz: %v", err)
		}
	}

	hit()
	hit()
	clock.advance(failOpenWarnInterval + time.Second)
	hit()

	if warnings := strings.Count(out.String(), "hiz siniri uygulanamadi"); warnings != 2 {
		t.Errorf("aralik gecince ikinci uyari yazilmali: %d", warnings)
	}
}

// hitRoot, "/" adresine istek gonderir ve govdeyi kapatir.
func hitRoot(app *fiber.App) error {
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	if err != nil {
		return err
	}
	response, err := app.Test(request)
	if err != nil {
		return err
	}
	return response.Body.Close()
}

func TestDisabledLimitAllowsEverything(t *testing.T) {
	app := limitedApp(t, RateLimit{}, &fakeOrders{}, silentLogger())

	for i := range 10 {
		if status, _, _ := getStatus(t, app, "/v1/categories", nil); status != http.StatusOK {
			t.Fatalf("sinir kapaliyken %d. istek gecmeli: %d", i+1, status)
		}
	}
}

func TestHealthzIsNeverLimited(t *testing.T) {
	// Altyapi yoklamasi (Docker HEALTHCHECK, orkestrator) sinira takilmamali.
	clock := newTestClock()
	app := limitedApp(t, memoryLimits(clock, 1, 1, 1), &fakeOrders{}, silentLogger())

	for i := range 3 {
		if status, _, _ := getStatus(t, app, "/healthz", nil); status != http.StatusOK {
			t.Fatalf("%d. saglik istegi 200 donmeli: %d", i+1, status)
		}
	}
}

func TestRouteLabelsFitRedisKitRouteRule(t *testing.T) {
	// Sayacin rota parcasi @getir/redis-kit ROUTE_PATTERN'e uymali (':' yok);
	// iki farkli rota ayni ada dusmemeli.
	raw, err := os.ReadFile("../../../../packages/redis-kit/src/keys.ts")
	if err != nil {
		t.Fatalf("redis-kit anahtar kaynagi okunamadi: %v", err)
	}
	match := regexp.MustCompile(`const ROUTE_PATTERN = /(.+)/;`).FindStringSubmatch(string(raw))
	if match == nil {
		t.Fatal("keys.ts'te ROUTE_PATTERN bulunamadi")
	}
	pattern := regexp.MustCompile(match[1])

	seen := map[string]string{}
	for _, route := range limitedApp(t, RateLimit{}, &fakeOrders{}, silentLogger()).GetRoutes(true) {
		if !strings.HasPrefix(route.Path, "/v1/") {
			continue
		}
		label := routeLabelOf(route.Method, route.Path)
		if !pattern.MatchString(label) {
			t.Errorf("%s %s: %q redis-kit kuralina uymuyor", route.Method, route.Path, label)
		}
		if other, taken := seen[label]; taken && other != route.Path {
			t.Errorf("%q iki rotaya dusuyor: %s ve %s", label, other, route.Path)
		}
		seen[label] = route.Path
	}
	if seen["POST_/v1/orders/id/3ds"] == "" || seen["POST_/v1/auth/login"] == "" {
		t.Errorf("beklenen rota adlari yok: %v", seen)
	}
}

func TestRetryAfterSecondsRoundsUp(t *testing.T) {
	for wait, seconds := range map[time.Duration]int{
		time.Millisecond:                      1,
		time.Second:                           1,
		time.Second + time.Millisecond:        2,
		59*time.Second + 999*time.Millisecond: 60,
		testWindow:                            60,
		0:                                     1,
	} {
		if got := retryAfterSeconds(wait); got != seconds {
			t.Errorf("%v: %d bekleniyordu, %d geldi", wait, seconds, got)
		}
	}
}

func TestNormalizeIPGivesOneCounterPerClient(t *testing.T) {
	for raw, normalized := range map[string]string{
		"10.0.0.1":        "10.0.0.1",
		"::ffff:10.0.0.1": "10.0.0.1",
		"fe80::1%lo0":     "fe80::1",
		"::1":             "::1",
		"2001:DB8::1":     "2001:db8::1",
		"ayni-degil":      "",
		"":                "",
	} {
		if got := normalizeIP(raw); got != normalized {
			t.Errorf("%q: %q bekleniyordu, %q geldi", raw, normalized, got)
		}
	}
}
