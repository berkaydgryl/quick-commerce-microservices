package telemetry

import (
	"context"
	"log/slog"

	"go.opentelemetry.io/otel/trace"
)

// traceHandler, baglamda gecerli bir span varsa kayda traceId ve spanId ekler
// (D15): istek kapsamindaki her satir (InfoContext, WarnContext...) iz
// goruntuleyicideki izle eslesir. Baglamsiz satir (acilis, kapanis) degismez.
type traceHandler struct {
	slog.Handler
}

// NewLogHandler, verilen isleyiciyi iz kimligi ekleyecek sekilde sarar.
func NewLogHandler(next slog.Handler) slog.Handler {
	return traceHandler{Handler: next}
}

// Handle, kayda iz alanlarini ekleyip asil isleyiciye iletir.
func (h traceHandler) Handle(ctx context.Context, record slog.Record) error {
	if spanContext := trace.SpanContextFromContext(ctx); spanContext.IsValid() {
		// Kopya: kayit cagiranla paylasiliyor olabilir (slog.Record belgesi).
		record = record.Clone()
		record.AddAttrs(
			slog.String("traceId", spanContext.TraceID().String()),
			slog.String("spanId", spanContext.SpanID().String()),
		)
	}
	// Sarmalayici: asil isleyicinin hatasi oldugu gibi doner.
	return h.Handler.Handle(ctx, record)
}

// WithAttrs, alt gunlukcu de iz alanlarini eklesin diye sarmalamayi korur.
func (h traceHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return traceHandler{Handler: h.Handler.WithAttrs(attrs)}
}

// WithGroup, alt gunlukcu de iz alanlarini eklesin diye sarmalamayi korur.
func (h traceHandler) WithGroup(name string) slog.Handler {
	return traceHandler{Handler: h.Handler.WithGroup(name)}
}
