// Package telemetry, gateway'in dagitik izlemesini kurar (D15, ADR-20): iz
// saglayicisi, OTLP/HTTP ile disari gonderme, W3C yayici, OpenTelemetry
// hatalarinin JSON gunluge yonlendirilmesi ve gunluk satirina iz kimligi.
//
// Kurallar Node servisleriyle (@getir/observability) AYNIDIR:
//   - Baglam W3C traceparent ile tasinir; her istek orneklenir, ust span'in
//     karari korunur (ParentBased(AlwaysSample)).
//   - Uc adresi yoksa span'ler yine olusur ve servislere tasinir (gunlukte
//     traceId), yalnizca disari gonderilmez.
//
// Kuresel OpenTelemetry durumu (otel.SetTracerProvider vb.) YALNIZCA main'de
// kurulur; paketler izleyiciyi ve yayiciyi parametre olarak alir. Testler
// boylece kuresel duruma dokunmadan kendi kaydedicisini verir (paralel test ve
// arka plan goroutine'leriyle yaris olmaz).
package telemetry

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// ServiceName, iz goruntuleyicide gateway'in adi (service.name).
const ServiceName = "gateway"

// InstrumentationName, gateway'in span'lerini acan kutuphanenin adi.
const InstrumentationName = "github.com/berkaydgryl/quick-commerce-microservices/apps/gateway"

// tracesPath, OTLP/HTTP'nin iz yolu; taban adrese eklenir.
const tracesPath = "/v1/traces"

// ErrorLogInterval, OpenTelemetry hatasinin (orn. Jaeger kapali: her partide
// gonderme duser) gunluge en sik yazilma araligi; aradakiler sayilir.
const ErrorLogInterval = time.Minute

// Tracing, kurulmus izleme: izleyici, yayici ve kapanista bosaltilacak saglayici.
type Tracing struct {
	provider   *sdktrace.TracerProvider
	Tracer     trace.Tracer
	Propagator propagation.TextMapPropagator
}

// Setup, iz saglayicisini kurar. endpoint bossa disari gonderilmez. Kuresel
// duruma DOKUNMAZ (bkz. Install).
func Setup(ctx context.Context, endpoint string) (*Tracing, error) {
	res, err := resource.Merge(resource.Default(), resource.NewSchemaless(attribute.String("service.name", ServiceName)))
	if err != nil {
		return nil, fmt.Errorf("iz kaynagi: %w", err)
	}
	options := []sdktrace.TracerProviderOption{
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.AlwaysSample())),
	}
	if endpoint != "" {
		exporter, err := otlptracehttp.New(ctx, otlptracehttp.WithEndpointURL(endpoint+tracesPath))
		if err != nil {
			return nil, fmt.Errorf("iz gondericisi: %w", err)
		}
		options = append(options, sdktrace.WithBatcher(exporter))
	}
	provider := sdktrace.NewTracerProvider(options...)
	return &Tracing{
		provider:   provider,
		Tracer:     provider.Tracer(InstrumentationName),
		Propagator: propagation.TraceContext{},
	}, nil
}

// Install, izlemeyi surecin kuresel OpenTelemetry durumu yapar ve kutuphane
// hatalarini gunluge yonlendirir (varsayilan isleyici stderr'e duz metin
// yazardi). Yalnizca main cagirir.
func (t *Tracing) Install(logger *slog.Logger) {
	otel.SetTracerProvider(t.provider)
	otel.SetTextMapPropagator(t.Propagator)
	otel.SetErrorHandler(NewErrorHandler(logger, time.Now))
}

// Shutdown, bekleyen span'leri gonderir ve saglayiciyi kapatir; ctx'in
// suresiyle sinirlidir.
func (t *Tracing) Shutdown(ctx context.Context) error {
	if err := t.provider.Shutdown(ctx); err != nil {
		return fmt.Errorf("izler gonderilemedi: %w", err)
	}
	return nil
}

// NewErrorHandler, OpenTelemetry hatalarini WARN olarak yazar; ayni sorun her
// partide tekrar ettigi icin satir ErrorLogInterval'da bir yazilir, aradakiler
// "suppressed" alaninda bildirilir.
func NewErrorHandler(logger *slog.Logger, now func() time.Time) otel.ErrorHandler {
	handler := &throttledErrorHandler{logger: logger, now: now}
	return otel.ErrorHandlerFunc(handler.handle)
}

type throttledErrorHandler struct {
	logger     *slog.Logger
	now        func() time.Time
	mu         sync.Mutex
	lastLogged time.Time
	suppressed int
}

func (h *throttledErrorHandler) handle(err error) {
	h.mu.Lock()
	at := h.now()
	if !h.lastLogged.IsZero() && at.Sub(h.lastLogged) < ErrorLogInterval {
		h.suppressed++
		h.mu.Unlock()
		return
	}
	suppressed := h.suppressed
	h.lastLogged = at
	h.suppressed = 0
	h.mu.Unlock()
	h.logger.Warn("izleme hatasi; izler gonderilemiyor olabilir",
		slog.Int("suppressed", suppressed), slog.Any("err", err))
}
