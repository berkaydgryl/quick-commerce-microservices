package httpapi

import (
	"bufio"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/telemetry"
)

// tracingRecorder, istek span'lerini kaydeden izleyici ve iz alanli gunluk.
type tracingRecorder struct {
	spans *tracetest.SpanRecorder
	logs  *logRecorder
}

func newTracingRecorder() *tracingRecorder {
	return &tracingRecorder{spans: tracetest.NewSpanRecorder(), logs: &logRecorder{}}
}

// apply, Deps'e izleyiciyi ve iz kimligi ekleyen gunlukcuyu takar.
func (r *tracingRecorder) apply(deps *Deps) {
	deps.Tracer = sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(r.spans)).Tracer("test")
	deps.Propagator = propagation.TraceContext{}
	deps.Logger = slog.New(telemetry.NewLogHandler(slog.NewJSONHandler(r.logs, nil)))
}

func (r *tracingRecorder) onlyServerSpan(t *testing.T) sdktrace.ReadOnlySpan {
	t.Helper()
	var found []sdktrace.ReadOnlySpan
	for _, span := range r.spans.Ended() {
		if span.SpanKind() == trace.SpanKindServer {
			found = append(found, span)
		}
	}
	if len(found) != 1 {
		t.Fatalf("tek istek span'i bekleniyordu, %d var", len(found))
	}
	return found[0]
}

func spanAttribute(span sdktrace.ReadOnlySpan, key string) any {
	for _, kv := range span.Attributes() {
		if string(kv.Key) == key {
			return kv.Value.AsInterface()
		}
	}
	return nil
}

func TestRequestSpanNamesRouteAndCarriesRequestID(t *testing.T) {
	lister := &fakeLister{list: catalog.CategoryList{Items: []catalog.Category{}}}
	recorder := newTracingRecorder()
	deps := appWith(lister)
	recorder.apply(&deps)

	response, err := New(deps).Test(newRequest(t, http.MethodGet, "/v1/categories", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	closeBody(t, response)

	span := recorder.onlyServerSpan(t)
	if span.Name() != "GET /v1/categories" {
		t.Errorf("span adi yontem + rota kalibi olmali: %q", span.Name())
	}
	requestID := response.Header.Get(RequestIDHeader)
	if spanAttribute(span, attrRequestID) != requestID || spanAttribute(span, attrHTTPRoute) != "/v1/categories" ||
		spanAttribute(span, attrHTTPStatus) != int64(http.StatusOK) || spanAttribute(span, attrHTTPMethod) != http.MethodGet {
		t.Errorf("nitelikler eksik ya da yanlis: %v (requestId %q)", span.Attributes(), requestID)
	}
	if span.Status().Code != codes.Unset {
		t.Errorf("200 hatali isaretlenmemeli: %v", span.Status())
	}
	// Giden gRPC cagrisi bu span'in baglamini tasir: servis span'i bunun cocugu olur.
	if trace.SpanContextFromContext(lister.ctx).SpanID() != span.SpanContext().SpanID() {
		t.Error("servise giden baglam istek span'ini tasimali")
	}
	// Istek gunlugu satiri span'in icinde yazilir: traceId tasir.
	var line map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(recorder.logs.buffer.String())), &line); err != nil {
		t.Fatalf("gunluk satiri JSON degil: %v", err)
	}
	if line["msg"] != "http istegi" || line["traceId"] != span.SpanContext().TraceID().String() {
		t.Errorf("istek satiri traceId tasimali: %v", line)
	}
}

func TestRequestSpanOmitsQueryClientIPAndUserAgent(t *testing.T) {
	recorder := newTracingRecorder()
	app := limitedApp(t, RateLimit{}, &fakeOrders{}, silentLogger(), recorder.apply)
	request := newRequest(t, http.MethodGet, "/v1/markets?lat=40.987654&lng=29.123456", nil)
	request.Header.Set("User-Agent", "deneme-ajan/1.0")

	response, err := app.Test(request)
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	closeBody(t, response)

	span := recorder.onlyServerSpan(t)
	if span.Name() != "GET /v1/markets" {
		t.Errorf("span adi rota kalibi olmali: %q", span.Name())
	}
	for _, kv := range span.Attributes() {
		value := kv.Value.String()
		if strings.Contains(value, "40.987654") || strings.Contains(value, "29.123456") || strings.Contains(value, "deneme-ajan") {
			t.Errorf("konum ya da kullanici ajani span'e girmemeli: %s=%s", kv.Key, value)
		}
		switch string(kv.Key) {
		case "url.query", "url.full", "client.address", "user_agent.original":
			t.Errorf("izin listesi disi nitelik: %s", kv.Key)
		}
	}
}

func TestRequestSpanContinuesIncomingTrace(t *testing.T) {
	recorder := newTracingRecorder()
	deps := appWith(&fakeLister{list: catalog.CategoryList{Items: []catalog.Category{}}})
	recorder.apply(&deps)
	request := newRequest(t, http.MethodGet, "/v1/categories", nil)
	request.Header.Set("traceparent", "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")

	response, err := New(deps).Test(request)
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	closeBody(t, response)

	span := recorder.onlyServerSpan(t)
	if span.SpanContext().TraceID().String() != "0af7651916cd43dd8448eb211c80319c" ||
		span.Parent().SpanID().String() != "b7ad6b7169203331" {
		t.Errorf("gelen iz surdurulmeli: trace %s, ust %s", span.SpanContext().TraceID(), span.Parent().SpanID())
	}
}

func TestRequestSpanMarksOnlyServerErrors(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		status int
		mark   codes.Code
		code   apperror.Code
	}{
		{"bagimli servis yok (503)", &apperror.Error{Code: apperror.CodeServiceUnavailable}, http.StatusServiceUnavailable, codes.Error, apperror.CodeServiceUnavailable},
		{"beklenmeyen (500)", &apperror.Error{Code: apperror.CodeInternal}, http.StatusInternalServerError, codes.Error, apperror.CodeInternal},
		{"bulunamadi (404)", &apperror.Error{Code: apperror.CodeNotFound}, http.StatusNotFound, codes.Unset, apperror.CodeNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := newTracingRecorder()
			deps := appWith(&fakeLister{err: tc.err})
			recorder.apply(&deps)

			response, err := New(deps).Test(newRequest(t, http.MethodGet, "/v1/categories", nil))
			if err != nil {
				t.Fatalf("istek basarisiz: %v", err)
			}
			closeBody(t, response)

			span := recorder.onlyServerSpan(t)
			if response.StatusCode != tc.status || spanAttribute(span, attrHTTPStatus) != int64(tc.status) {
				t.Fatalf("%d bekleniyordu: cevap %d, span %v", tc.status, response.StatusCode, spanAttribute(span, attrHTTPStatus))
			}
			if span.Status().Code != tc.mark || spanAttribute(span, attrErrorCode) != string(tc.code) {
				t.Errorf("span %v / %s bekleniyordu: %v / %v", tc.mark, tc.code, span.Status(), spanAttribute(span, attrErrorCode))
			}
		})
	}
}

func TestRequestSpanUsesRouteTemplateNotRawPath(t *testing.T) {
	// Kimlik tasiyan yol parcasi span adina girmez (sayisiz ad uretirdi): ad ve
	// http.route rota kalibi, ham yol yalnizca url.path'te.
	recorder := newTracingRecorder()
	app := limitedApp(t, RateLimit{}, &fakeOrders{}, silentLogger(), recorder.apply)

	response, err := app.Test(newRequest(t, http.MethodGet, "/v1/orders/ord_bir-kimlik", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	closeBody(t, response)

	span := recorder.onlyServerSpan(t)
	if span.Name() != "GET /v1/orders/:id" || spanAttribute(span, attrHTTPRoute) != "/v1/orders/:id" ||
		spanAttribute(span, attrURLPath) != "/v1/orders/ord_bir-kimlik" {
		t.Errorf("ad ve rota kalip, yol ham olmali: %q %v", span.Name(), span.Attributes())
	}
}

func TestHealthzIsNotTraced(t *testing.T) {
	// Docker her 15 sn'de yoklar: span acilmaz, istek satiri yine yazilir
	// (traceId'siz).
	recorder := newTracingRecorder()
	deps := Deps{Health: fakeReporter{report: healthyReport()}}
	recorder.apply(&deps)

	response, err := New(deps).Test(newRequest(t, http.MethodGet, healthPath, nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	closeBody(t, response)

	if response.StatusCode != http.StatusOK {
		t.Fatalf("200 bekleniyordu: %d", response.StatusCode)
	}
	if spans := recorder.spans.Ended(); len(spans) != 0 {
		t.Errorf("/healthz span acmamali: %d span", len(spans))
	}
	var line map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(recorder.logs.buffer.String())), &line); err != nil {
		t.Fatalf("gunluk satiri JSON degil: %v", err)
	}
	if _, found := line["traceId"]; line["msg"] != "http istegi" || found {
		t.Errorf("istek satiri yazilmali ve traceId tasimamali: %v", line)
	}
}

func TestUnknownPathSpanKeepsMethodOnlyName(t *testing.T) {
	recorder := newTracingRecorder()
	deps := appWith(&fakeLister{})
	recorder.apply(&deps)

	response, err := New(deps).Test(newRequest(t, http.MethodGet, "/v1/yok/ord_bir-kimlik", nil))
	if err != nil {
		t.Fatalf("istek basarisiz: %v", err)
	}
	closeBody(t, response)

	// Eslesmeyen yol span adina girmez: rastgele yollar sayisiz span adi uretirdi.
	if span := recorder.onlyServerSpan(t); span.Name() != http.MethodGet || spanAttribute(span, attrHTTPRoute) != nil {
		t.Errorf("eslesmeyen yolda ad yalnizca yontem olmali: %q %v", span.Name(), span.Attributes())
	}
}

func TestOversizedBodySpanEndsWithFinalStatus(t *testing.T) {
	// Fiber'in sunucu hatasi on gecisi: span da istek satiri gibi bekletilir ve
	// hata isleyici cevabi yazdiktan SONRA son durumla kapatilir (body_test.go).
	recorder := newTracingRecorder()
	app := limitedApp(t, RateLimit{}, &fakeOrders{}, silentLogger(), recorder.apply)
	dialer := net.Dialer{Timeout: ioDeadline}
	conn, err := dialer.DialContext(t.Context(), "tcp", serveOnLoopback(t, app))
	if err != nil {
		t.Fatalf("baglanilamadi: %v", err)
	}
	t.Cleanup(func() {
		if closeErr := conn.Close(); closeErr != nil {
			t.Errorf("baglanti kapatilamadi: %v", closeErr)
		}
	})
	if err = conn.SetDeadline(time.Now().Add(ioDeadline)); err != nil {
		t.Fatalf("son tarih konamadi: %v", err)
	}
	// Govde gonderilmez (body_test.go'daki Linux RST notu).
	head := "POST /v1/cart/reserve HTTP/1.1\r\n" +
		"Host: gateway\r\n" +
		fiber.HeaderContentType + ": " + fiber.MIMEApplicationJSON + "\r\n" +
		fiber.HeaderContentLength + ": " + strconv.Itoa(maxBodyBytes+1) + "\r\n\r\n"
	if _, err = io.WriteString(conn, head); err != nil {
		t.Fatalf("istek yazilamadi: %v", err)
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("cevap okunamadi: %v", err)
	}
	closeBody(t, response)

	span := recorder.onlyServerSpan(t)
	if spanAttribute(span, attrHTTPStatus) != int64(response.StatusCode) || spanAttribute(span, attrErrorCode) != string(apperror.CodeValidationFailed) {
		t.Errorf("span cevabin son durumunu (%d) ve kodunu tasimali: %v", response.StatusCode, span.Attributes())
	}
}
