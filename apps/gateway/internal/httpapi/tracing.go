package httpapi

import (
	"strconv"
	"time"

	"github.com/gofiber/fiber/v3"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

// Span nitelikleri. HTTP olanlar OpenTelemetry anlam kurallarindan; istek
// kimligi Node servisleriyle ayni adla (app.request_id): Jaeger'de bu etiketle
// aranir, REST cevabindaki error.requestId ile eslesir.
const (
	attrHTTPMethod = "http.request.method"
	attrHTTPRoute  = "http.route"
	attrHTTPStatus = "http.response.status_code"
	attrURLPath    = "url.path"
	attrRequestID  = "app.request_id"
	attrErrorCode  = "app.error_code"
)

// pendingSpanKey, istek span'i hata isleyiciye birakildiginda span'i tasir
// (Fiber'in sunucu hatasi on gecisi; bkz. middleware.go pendingRequestLogKey).
type pendingSpanKey struct{}

// tracingMiddleware, her HTTP istegi icin bir sunucu span'i acar (D15, ADR-20).
//
// Nitelikler IZIN LISTESIYLE yazilir: yontem, rota kalibi, yol, durum kodu ve
// istek kimligi. Sorgu dizesi (konum, arama metni), istemci IP'si ve kullanici
// ajani YAZILMAZ: izler de gunluk gibi kisisel veri tasimaz (proje kurali).
// Resmi Fiber ara katmani sorguyu ve tam adresi her zaman yazdigi icin
// kullanilmadi (D15, karar 3b).
//
// Zincirde istek kimliginden SONRA, istek gunlugunden ONCE durur: span'de
// requestId vardir; istek gunlugu hatayi cevaba cevirdikten sonra span
// cevabin son durumuyla kapanir. Gunluk satiri c.Context()'teki span'den
// traceId alir.
//
// /healthz izlenmez (healthPath); istek gunlugu satiri yine yazilir. Servislere
// giden saglik cagrilari da izlenmez (rpc.TracingInterceptor).
func tracingMiddleware(tracer trace.Tracer, propagator propagation.TextMapPropagator) fiber.Handler {
	return func(c fiber.Ctx) error {
		if c.Path() == healthPath {
			return c.Next()
		}
		// Gelen traceparent (orn. onde bir vekil) varsa iz onun devamidir.
		parent := propagator.Extract(c.Context(), fiberHeaderCarrier{c: c})
		ctx, span := tracer.Start(parent, c.Method(),
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(
				attribute.String(attrHTTPMethod, c.Method()),
				attribute.String(attrURLPath, c.Path()),
				attribute.String(attrRequestID, requestIDOf(c)),
			))
		// Giden gRPC cagrisi (outgoingContext) ve gunluk satiri bu baglami gorur.
		c.SetContext(ctx)

		err := c.Next()
		if err != nil {
			// istek gunlugu hatayi cevaba cevirir; buraya gelen yazilamamis cevaptir.
			span.RecordError(err)
		}
		if _, pending := c.Locals(pendingRequestLogKey{}).(time.Time); pending {
			// Fiber'in sunucu hatasi on gecisi: cevabi hata isleyici SONRA yazar,
			// span'i de son durumla o kapatir (errors.go).
			c.Locals(pendingSpanKey{}, span)
			return err
		}
		endRequestSpan(c, span)
		return err
	}
}

// endRequestSpan, span'i cevabin son durumuyla kapatir. Ad "YONTEM /rota/kalibi"
// (ham yol degil: kimlik tasiyan yol parcalari span adina girmez). 5xx hata
// sayilir; 4xx istemcinin sonucudur (OpenTelemetry HTTP sunucu kurali).
func endRequestSpan(c fiber.Ctx, span trace.Span) {
	status := c.Response().StatusCode()
	span.SetAttributes(attribute.Int(attrHTTPStatus, status))
	if c.Matched() {
		route := c.Route().Path
		span.SetName(c.Method() + " " + route)
		span.SetAttributes(attribute.String(attrHTTPRoute, route))
	}
	if status >= fiber.StatusInternalServerError {
		span.SetStatus(codes.Error, strconv.Itoa(status))
	}
	span.End()
}

// endPendingSpan, hata isleyicinin cagirdigi kapanis: on gecisteki istegin
// span'i cevap yazildiktan sonra kapanir.
func endPendingSpan(c fiber.Ctx) {
	if span, pending := c.Locals(pendingSpanKey{}).(trace.Span); pending {
		c.Locals(pendingSpanKey{}, nil)
		endRequestSpan(c, span)
	}
}

// fiberHeaderCarrier, istek basliklarini W3C yayicisinin tasiyicisi yapar
// (yalnizca okunur: cevaba iz basligi yazilmaz).
type fiberHeaderCarrier struct {
	c fiber.Ctx
}

func (h fiberHeaderCarrier) Get(key string) string {
	return h.c.Get(key)
}

func (h fiberHeaderCarrier) Set(string, string) {}

func (h fiberHeaderCarrier) Keys() []string {
	headers := h.c.GetReqHeaders()
	keys := make([]string, 0, len(headers))
	for key := range headers {
		keys = append(keys, key)
	}
	return keys
}
