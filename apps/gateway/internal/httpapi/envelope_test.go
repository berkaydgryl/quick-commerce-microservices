package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health/grpc_health_v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/health"
)

// Kabul olcutu (T8.3): "Her cevap ayni zarfta, requestId logla eslesir".
//
// Uclarin kendi testleri kendi cevaplarini dener; bu dosya BUTUN rotalari
// tarar. Yarin eklenen bir uc zarfsiz cevap yazar, sozlukte olmayan bir kod
// doner ya da gunluge dusmezse burada kirmizi olur. Ozel durumlar (bilinmeyen
// yol, yanlis fiil, bozuk JSON, jetonsuz uc, hiz siniri, panik) ayrica sinanir.

// logRecorder, gunluk satirlarini toplar; yazim istek goroutine'inden gelir.
type logRecorder struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (r *logRecorder) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.buffer.Write(p)
}

func (r *logRecorder) logger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(r, nil))
}

// logRecord, gunluk satirinin sinanan alanlari.
type logRecord struct {
	Level     string `json:"level"`
	Msg       string `json:"msg"`
	RequestID string `json:"requestId"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	Status    int    `json:"status"`
	Code      string `json:"code"`
	Err       string `json:"err"`
	RawStatus int    `json:"rawStatus"`
	Stack     string `json:"stack"`
}

// recordsOf, verilen kimligi tasiyan satirlar; her satir JSON olmali.
func (r *logRecorder) recordsOf(t *testing.T, requestID string) []logRecord {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	var records []logRecord
	for _, line := range strings.Split(strings.TrimSpace(r.buffer.String()), "\n") {
		if line == "" {
			continue
		}
		var record logRecord
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("gunluk satiri JSON degil: %q", line)
		}
		if record.RequestID == requestID {
			records = append(records, record)
		}
	}
	return records
}

// only, verilen mesajli tek satir; yoksa ya da birden coksa test duser.
func only(t *testing.T, records []logRecord, msg string) logRecord {
	t.Helper()
	var found []logRecord
	for _, record := range records {
		if record.Msg == msg {
			found = append(found, record)
		}
	}
	if len(found) != 1 {
		t.Fatalf("%q satirindan tam bir tane bekleniyordu, %d var: %+v", msg, len(found), records)
	}
	return found[0]
}

// strictResult, bir istek-cevap: durum, basliklar ve KATI okunmus zarf. Cevap
// govdesi strictExchange'te okunup kapanir; *http.Response disari cikmaz
// (bodyclose denetleyicisi kapatmayi yalnizca cevabin alindigi fonksiyonda
// gorur).
type strictResult struct {
	status int
	header http.Header
	// success false ise errorBody doludur.
	success   bool
	errorBody *APIError
	raw       string
}

func strictExchange(t *testing.T, app *fiber.App, request *http.Request) strictResult {
	t.Helper()
	response, err := app.Test(request)
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
	result := strictResult{status: response.StatusCode, header: response.Header, raw: string(body)}
	parseStrictEnvelope(t, &result, body)
	return result
}

// parseStrictEnvelope, govdeyi zarf olarak KATI okur: basari kolunda yalnizca
// data, hata kolunda yalnizca error (code, message, requestId, istege bagli
// details). Gevsek cozum `{}`'u da "basarisiz zarf" sanardi.
func parseStrictEnvelope(t *testing.T, result *strictResult, body []byte) {
	t.Helper()
	if contentType := result.header.Get(fiber.HeaderContentType); !strings.HasPrefix(contentType, fiber.MIMEApplicationJSON) {
		t.Fatalf("JSON cevap bekleniyordu, Content-Type %q: %s", contentType, body)
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(body, &top); err != nil {
		t.Fatalf("cevap JSON nesnesi degil: %s", body)
	}
	if err := json.Unmarshal(top["success"], &result.success); err != nil {
		t.Fatalf("zarfta success alani yok ya da bool degil: %s", body)
	}
	allowed := map[bool][]string{true: {"success", "data"}, false: {"success", "error"}}[result.success]
	if len(top) != len(allowed) {
		t.Fatalf("zarfta yalnizca %v olmali: %s", allowed, body)
	}
	for _, key := range allowed {
		if _, found := top[key]; !found {
			t.Fatalf("zarfta %q yok: %s", key, body)
		}
	}
	if result.success {
		return
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(top["error"], &fields); err != nil {
		t.Fatalf("error nesne degil: %s", body)
	}
	for key := range fields {
		if key != "code" && key != "message" && key != "requestId" && key != "details" {
			t.Errorf("hata zarfinda beklenmeyen alan %q: %s", key, body)
		}
	}
	result.errorBody = &APIError{}
	if err := json.Unmarshal(top["error"], result.errorBody); err != nil {
		t.Fatalf("hata govdesi cozulemedi: %s", body)
	}
}

// assertEnvelopeContract, zarfin sozlesmesi: kimlik bicimli ve baslikla ayni;
// hata kodu sozlukte, mesaj ve HTTP kodu koddan turemis.
func assertEnvelopeContract(t *testing.T, result strictResult) string {
	t.Helper()
	requestID := result.header.Get(RequestIDHeader)
	if !validRequestID(requestID) {
		t.Errorf("X-Request-ID bicimli olmali: %q", requestID)
	}
	if result.success {
		return requestID
	}
	got := result.errorBody
	if !apperror.Known(got.Code) {
		t.Errorf("sozlukte olmayan kod: %q", got.Code)
	}
	if got.Message != apperror.Message(got.Code) {
		t.Errorf("mesaj sozlukten gelmeli: %q", got.Message)
	}
	if result.status != apperror.HTTPStatus(got.Code) {
		t.Errorf("HTTP kodu %s'in tablodaki karsiligi (%d) olmali, %d geldi", got.Code, apperror.HTTPStatus(got.Code), result.status)
	}
	if got.RequestID != requestID {
		t.Errorf("zarftaki requestId (%q) baslikla (%q) ayni olmali", got.RequestID, requestID)
	}
	return requestID
}

// assertLogged, cevabin kimligi gunlukte: istek satiri ayni durumla; hata
// cevabinda hata satiri ayni kodla.
func assertLogged(t *testing.T, recorder *logRecorder, requestID string, result strictResult) {
	t.Helper()
	records := recorder.recordsOf(t, requestID)
	request := only(t, records, "http istegi")
	if request.Status != result.status {
		t.Errorf("istek satirinda durum %d olmali, %d yazildi", result.status, request.Status)
	}
	if result.success {
		return
	}
	failure := only(t, records, "istek hatayla dondu")
	if failure.Code != string(result.errorBody.Code) {
		t.Errorf("hata satirinda kod %s olmali, %s yazildi", result.errorBody.Code, failure.Code)
	}
}

// routeParamValues, rota taramasinin yol parametrelerine koydugu degerler.
// Yeni bir parametre adi eklenince buraya deger yazilir; yoksa tarama durur.
var routeParamValues = map[string]string{
	marketIDParam: "mkt_a101-caferaga",
	orderIDParam:  testOrderID,
}

type sweptRoute struct {
	method, pattern, path string
}

// routesOf, uygulamanin kayitli rotalari (ara katmanlar ve HEAD haric; HEAD
// govdesiz cevaptir, GET'in kendisi taranir), parametreler dolu.
func routesOf(t *testing.T, app *fiber.App) []sweptRoute {
	t.Helper()
	var routes []sweptRoute
	seen := map[string]bool{}
	for _, route := range app.GetRoutes(true) {
		if route.Method == fiber.MethodHead || seen[route.Method+route.Path] {
			continue
		}
		seen[route.Method+route.Path] = true
		path := route.Path
		for _, param := range route.Params {
			value, known := routeParamValues[param]
			if !known {
				t.Fatalf("%s %s: %q parametresine tarama degeri yok (routeParamValues)", route.Method, route.Path, param)
			}
			path = strings.Replace(path, ":"+param, value, 1)
		}
		routes = append(routes, sweptRoute{method: route.Method, pattern: route.Path, path: path})
	}
	return routes
}

func TestEveryRouteAnswersInTheEnvelope(t *testing.T) {
	recorder := &logRecorder{}
	app := limitedApp(t, RateLimit{}, &fakeOrders{}, recorder.logger())

	routes := routesOf(t, app)
	// Tarama bos donerse test bir sey sinamadan gecerdi.
	if len(routes) < 15 {
		t.Fatalf("en az 15 rota bekleniyordu, %d bulundu: %+v", len(routes), routes)
	}

	for _, route := range routes {
		t.Run(route.method+" "+route.pattern, func(t *testing.T) {
			// Kimliksiz, govdesiz, anahtarsiz: istemcinin en kotu ilk denemesi.
			result := strictExchange(t, app, newRequest(t, route.method, route.path, nil))

			requestID := assertEnvelopeContract(t, result)
			assertLogged(t, recorder, requestID, result)
			if result.status >= http.StatusInternalServerError {
				t.Errorf("govdesiz ve kimliksiz istek 5xx dondu (ucta yakalanmamis durum): %d %s", result.status, result.raw)
			}
		})
	}
}

func TestErrorCasesAnswerInTheEnvelopeAndMatchTheLog(t *testing.T) {
	cases := []struct {
		name     string
		request  func(t *testing.T) *http.Request
		wantCode apperror.Code
	}{
		{"bilinmeyen yol", func(t *testing.T) *http.Request {
			return newRequest(t, http.MethodGet, "/v1/yok", nil)
		}, apperror.CodeNotFound},
		{"yanlis fiil", func(t *testing.T) *http.Request {
			return newRequest(t, http.MethodDelete, "/v1/categories", nil)
		}, apperror.CodeNotFound},
		{"bozuk JSON", func(t *testing.T) *http.Request {
			return jsonRequest(t, http.MethodPost, "/v1/auth/login", "{", nil)
		}, apperror.CodeValidationFailed},
		{"jetonsuz korumali uc", func(t *testing.T) *http.Request {
			return newRequest(t, http.MethodGet, "/v1/me", nil)
		}, apperror.CodeUnauthorized},
		{"anahtarsiz kayit", func(t *testing.T) *http.Request {
			return jsonRequest(t, http.MethodPost, "/v1/auth/register", registerBodyOf(testPhone, testPassword, "Test Kisi"), nil)
		}, apperror.CodeValidationFailed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := &logRecorder{}
			app := limitedApp(t, RateLimit{}, &fakeOrders{}, recorder.logger())

			result := strictExchange(t, app, tc.request(t))

			requestID := assertEnvelopeContract(t, result)
			if result.success || result.errorBody.Code != tc.wantCode {
				t.Fatalf("%s bekleniyordu: %s", tc.wantCode, result.raw)
			}
			assertLogged(t, recorder, requestID, result)
		})
	}
}

func TestRateLimitedAnswerMatchesTheLog(t *testing.T) {
	recorder := &logRecorder{}
	app := limitedApp(t, memoryLimits(newTestClock(), 100, 1, 100), &fakeOrders{}, recorder.logger())
	login := func() strictResult {
		return strictExchange(t, app, jsonRequest(t, http.MethodPost, "/v1/auth/login", loginBodyOf(testPhone, testPassword), nil))
	}
	if first := login(); first.status == http.StatusTooManyRequests {
		t.Fatalf("ilk giris sinira takilmamali: %s", first.raw)
	}

	result := login()

	requestID := assertEnvelopeContract(t, result)
	if result.success || result.errorBody.Code != apperror.CodeRateLimited || result.header.Get(fiber.HeaderRetryAfter) == "" {
		t.Fatalf("Retry-After ile 429 RATE_LIMITED bekleniyordu: %v %s", result.header, result.raw)
	}
	assertLogged(t, recorder, requestID, result)
}

// panicRoute, testin kendi rotasi: uretim koduna "panik ucu" eklenmez. Rota
// New'den SONRA eklenir; ara katmanlar (kimlik, gunluk, kurtarma) once
// kaydedildigi icin ona da uygulanir.
const panicRoute = "/v1/test-panik"

func TestPanicBecomesInternalEnvelopeAndIsLogged(t *testing.T) {
	recorder := &logRecorder{}
	app := limitedApp(t, RateLimit{}, &fakeOrders{}, recorder.logger())
	app.Get(panicRoute, func(fiber.Ctx) error {
		var counters map[string]int
		counters["gizli-ayrinti"]++ // nil haritaya yazim: calisma zamani panigi
		return nil
	})
	request := newRequest(t, http.MethodGet, panicRoute, nil)
	request.Header.Set(RequestIDHeader, testRequestID)

	result := strictExchange(t, app, request)

	assertEnvelopeContract(t, result)
	if result.status != http.StatusInternalServerError || result.errorBody.Code != apperror.CodeInternal {
		t.Fatalf("500 INTERNAL bekleniyordu: %d %s", result.status, result.raw)
	}
	if result.errorBody.RequestID != testRequestID || result.errorBody.Details != nil {
		t.Errorf("istemcinin kimligi ve ayrintisiz hata bekleniyordu: %s", result.raw)
	}
	for _, leak := range []string{"gizli-ayrinti", "goroutine", "panic", "map"} {
		if strings.Contains(result.raw, leak) {
			t.Errorf("panik ayrintisi (%q) cevaba girmemeli: %s", leak, result.raw)
		}
	}

	records := recorder.recordsOf(t, testRequestID)
	if request := only(t, records, "http istegi"); request.Status != http.StatusInternalServerError {
		t.Errorf("istek satirinda 500 bekleniyordu: %+v", request)
	}
	panicked := only(t, records, "istek panikle dondu")
	if panicked.Level != "ERROR" || panicked.Code != string(apperror.CodeInternal) || !strings.Contains(panicked.Err, "nil map") {
		t.Errorf("ERROR seviyesinde, INTERNAL kodlu ve panik degerli satir bekleniyordu: %+v", panicked)
	}
	if !strings.Contains(panicked.Stack, "TestPanicBecomesInternalEnvelopeAndIsLogged") {
		t.Errorf("yigin izi panigin cikis noktasini gostermeli:\n%s", panicked.Stack)
	}

	// Surec ayakta: sonraki istek her zamanki gibi cevaplanir.
	if next := strictExchange(t, app, newRequest(t, http.MethodGet, "/healthz", nil)); next.status != http.StatusOK {
		t.Errorf("panikten sonra gateway cevap vermeli: %d %s", next.status, next.raw)
	}
}

func TestPanicValueNeverChoosesTheResponse(t *testing.T) {
	// Fiber'in varsayilan isleyicisi error degerli panigi aynen kullanirdi:
	// panic(NOT_FOUND) 404 olurdu. Panik her zaman INTERNAL'dir.
	app := limitedApp(t, RateLimit{}, &fakeOrders{}, silentLogger())
	app.Get(panicRoute, func(fiber.Ctx) error {
		panic(apperror.New(apperror.CodeNotFound, nil))
	})

	result := strictExchange(t, app, newRequest(t, http.MethodGet, panicRoute, nil))

	if result.status != http.StatusInternalServerError || result.errorBody == nil || result.errorBody.Code != apperror.CodeInternal {
		t.Fatalf("500 INTERNAL bekleniyordu: %d %s", result.status, result.raw)
	}
}

type panickingHealthClient struct{}

func (panickingHealthClient) Check(context.Context, *grpc_health_v1.HealthCheckRequest, ...grpc.CallOption) (*grpc_health_v1.HealthCheckResponse, error) {
	panic("saglik istemcisi bozuldu")
}

func TestHealthzSurvivesPanickingProbe(t *testing.T) {
	// Saglik sorgusu ayri goroutine'de calisir; oradaki panik HTTP kurtarmasina
	// ulasmaz. Denetleyici yakalar (health.Checker.guard): 503 zarfi, servis
	// UNREACHABLE/Internal, panik ayni istek kimligiyle gunlukte.
	recorder := &logRecorder{}
	checker := health.New(map[string]health.Client{"catalog": panickingHealthClient{}}, nil, time.Second, false, recorder.logger())
	app := New(Deps{Health: checker, Logger: recorder.logger()})
	request := newRequest(t, http.MethodGet, "/healthz", nil)
	request.Header.Set(RequestIDHeader, testRequestID)

	result := strictExchange(t, app, request)

	assertEnvelopeContract(t, result)
	if result.success || result.errorBody.Code != apperror.CodeServiceUnavailable {
		t.Fatalf("503 SERVICE_UNAVAILABLE bekleniyordu: %s", result.raw)
	}
	if !strings.Contains(result.raw, `"status":"UNREACHABLE","latencyMs":`) || !strings.Contains(result.raw, `"error":"Internal"`) {
		t.Errorf("servis UNREACHABLE/Internal olmali: %s", result.raw)
	}
	if strings.Contains(result.raw, "bozuldu") {
		t.Errorf("panik degeri cevaba girmemeli: %s", result.raw)
	}
	records := recorder.recordsOf(t, testRequestID)
	only(t, records, "saglik sorgusunda panik")
	if request := only(t, records, "http istegi"); request.Status != http.StatusServiceUnavailable {
		t.Errorf("istek satirinda 503 bekleniyordu: %+v", request)
	}
}
