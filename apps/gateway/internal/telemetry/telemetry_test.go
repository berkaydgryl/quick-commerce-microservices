package telemetry_test

import (
	"bytes"
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

	"go.opentelemetry.io/otel/trace"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/telemetry"
)

// collector, OTLP/HTTP isteklerini yakalayan yerel toplayici (Jaeger'in yerine).
type collector struct {
	mu       sync.Mutex
	paths    []string
	types    []string
	payloads [][]byte
}

func (c *collector) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	c.mu.Lock()
	c.paths = append(c.paths, r.URL.Path)
	c.types = append(c.types, r.Header.Get("Content-Type"))
	c.payloads = append(c.payloads, body)
	c.mu.Unlock()
	w.WriteHeader(http.StatusOK)
}

func TestSetupExportsSpansOverOTLPHTTP(t *testing.T) {
	sink := &collector{}
	server := httptest.NewServer(sink)
	t.Cleanup(server.Close)

	tracing, err := telemetry.Setup(t.Context(), server.URL)
	if err != nil {
		t.Fatalf("kurulum basarisiz: %v", err)
	}
	_, span := tracing.Tracer.Start(t.Context(), "deneme-span")
	span.End()

	// Kapanis bekleyen span'leri gonderir (toplu islemci).
	if err := tracing.Shutdown(t.Context()); err != nil {
		t.Fatalf("kapanis basarisiz: %v", err)
	}

	sink.mu.Lock()
	defer sink.mu.Unlock()
	if len(sink.paths) == 0 || sink.paths[0] != "/v1/traces" {
		t.Fatalf("/v1/traces'e istek bekleniyordu: %v", sink.paths)
	}
	if sink.types[0] != "application/x-protobuf" {
		t.Errorf("OTLP/HTTP protobuf bekleniyordu: %q", sink.types[0])
	}
	if !bytes.Contains(sink.payloads[0], []byte("deneme-span")) || !bytes.Contains(sink.payloads[0], []byte(telemetry.ServiceName)) {
		t.Error("gonderilen yukte span adi ve servis adi (gateway) olmali")
	}
}

func TestSetupWithoutEndpointStillCreatesSpans(t *testing.T) {
	tracing, err := telemetry.Setup(t.Context(), "")
	if err != nil {
		t.Fatalf("kurulum basarisiz: %v", err)
	}
	t.Cleanup(func() {
		if shutdownErr := tracing.Shutdown(context.WithoutCancel(t.Context())); shutdownErr != nil {
			t.Errorf("kapanis basarisiz: %v", shutdownErr)
		}
	})

	_, span := tracing.Tracer.Start(t.Context(), "yerel")
	defer span.End()

	// Disari gonderilmez ama iz kimligi gecerlidir: gunluk ve gRPC tasir.
	if !span.SpanContext().IsValid() || !span.IsRecording() {
		t.Error("adres yokken de span gecerli ve kayitta olmali")
	}
	carrier := map[string]string{}
	tracing.Propagator.Inject(trace.ContextWithSpan(t.Context(), span), mapCarrier(carrier))
	if !strings.HasPrefix(carrier["traceparent"], "00-"+span.SpanContext().TraceID().String()) {
		t.Errorf("W3C traceparent bekleniyordu: %v", carrier)
	}
}

func TestErrorHandlerLogsAtMostOncePerInterval(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil))
	now := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	handler := telemetry.NewErrorHandler(logger, func() time.Time { return now })

	handler.Handle(errTest("bir"))
	handler.Handle(errTest("iki"))
	now = now.Add(telemetry.ErrorLogInterval - time.Nanosecond)
	handler.Handle(errTest("uc"))
	now = now.Add(time.Nanosecond)
	handler.Handle(errTest("dort"))

	var suppressed []int
	for line := range strings.SplitSeq(strings.TrimSpace(output.String()), "\n") {
		var record struct {
			Level      string `json:"level"`
			Suppressed int    `json:"suppressed"`
		}
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("satir JSON degil: %q", line)
		}
		if record.Level != "WARN" {
			t.Errorf("WARN bekleniyordu: %q", line)
		}
		suppressed = append(suppressed, record.Suppressed)
	}
	if len(suppressed) != 2 || suppressed[0] != 0 || suppressed[1] != 2 {
		t.Errorf("iki satir (0 ve 2 bastirilmis) bekleniyordu: %v", suppressed)
	}
}

func TestLogHandlerAddsTraceFieldsOnlyInsideSpan(t *testing.T) {
	tracing, err := telemetry.Setup(t.Context(), "")
	if err != nil {
		t.Fatalf("kurulum basarisiz: %v", err)
	}
	var output bytes.Buffer
	logger := slog.New(telemetry.NewLogHandler(slog.NewJSONHandler(&output, nil))).With(slog.String("service", "gateway"))
	ctx, span := tracing.Tracer.Start(t.Context(), "istek")

	logger.InfoContext(ctx, "span icinde")
	span.End()
	logger.InfoContext(t.Context(), "span disinda")

	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	var inside, outside map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &inside); err != nil {
		t.Fatalf("satir JSON degil: %v", err)
	}
	if err := json.Unmarshal([]byte(lines[1]), &outside); err != nil {
		t.Fatalf("satir JSON degil: %v", err)
	}
	if inside["traceId"] != span.SpanContext().TraceID().String() || inside["spanId"] != span.SpanContext().SpanID().String() {
		t.Errorf("span icindeki satir iz kimligini tasimali: %v", inside)
	}
	if inside["service"] != "gateway" {
		t.Errorf("alt gunlukcu alanlari korunmali: %v", inside)
	}
	if _, found := outside["traceId"]; found {
		t.Errorf("span disindaki satir iz kimligi tasimamali: %v", outside)
	}
}

type errTest string

func (e errTest) Error() string { return string(e) }

type mapCarrier map[string]string

func (m mapCarrier) Get(key string) string { return m[key] }
func (m mapCarrier) Set(key, value string) { m[key] = value }
func (m mapCarrier) Keys() []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	return keys
}
