package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/gofiber/fiber/v3"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// errorHandler, yakalanmamis her hatayi tek zarfa cevirir.
//
// Uc kaynak vardir: bizim urettigimiz *apperror.Error (dogrulama, bagimli
// servis hatasi), Fiber'in kendi hatalari (bilinmeyen yol, yanlis fiil) ve
// ucta yakalanan panik (recover.go, T8.3). Hepsi sozlukteki bir koda iner;
// ic mesaj, sebep ve yigin izi istemciye GITMEZ, yalnizca gunluge yazilir.
func errorHandler(logger *slog.Logger) fiber.ErrorHandler {
	return func(c fiber.Ctx, err error) error {
		appErr := toAppError(err)
		requestID := ensureRequestID(c)
		// Istek span'i hatanin sozluk kodunu tasir (D15; Node span'leriyle ayni ad).
		trace.SpanFromContext(c.Context()).SetAttributes(attribute.String(attrErrorCode, string(appErr.Code)))

		// 4xx istemcinin hatasidir, gateway'in degil: ERROR seviyesi alarm
		// gurultusu uretirdi.
		level := slog.LevelWarn
		if apperror.HTTPStatus(appErr.Code) >= http.StatusInternalServerError {
			level = slog.LevelError
		}
		message := "istek hatayla dondu"
		attrs := []any{
			slog.String("path", c.Path()),
			slog.String("code", string(appErr.Code)),
			slog.String("requestId", requestID),
			slog.Any("err", err),
		}
		// Fiber'in ham kodu (413, 405...) cevapta sozluk koduna iner; kendisi
		// burada kalir (classify).
		var fiberErr *fiber.Error
		if errors.As(err, &fiberErr) {
			attrs = append(attrs, slog.Int("rawStatus", fiberErr.Code))
		}
		// Panik (recover.go): ayri mesajla, yigin iziyle. Aranan ve alarm
		// kurulan satir budur; iz yalnizca gunlukte durur.
		var panicked *recoveredPanic
		if errors.As(err, &panicked) {
			message = "istek panikle dondu"
			attrs = append(attrs, slog.String("stack", panicked.stack))
		}
		logger.Log(c.Context(), level, message, attrs...)

		// nil harita "details": {} degil, alan yok olarak cikmali.
		var details any
		if len(appErr.Details) > 0 {
			details = appErr.Details
		}
		written := fail(c, appErr.Code, details)

		// Fiber'in sunucu hatasi on gecisinde istek satiri bekletildi
		// (middleware.go): cevap artik son haliyle yazili, satir burada.
		if startedAt, pending := c.Locals(pendingRequestLogKey{}).(time.Time); pending {
			c.Locals(pendingRequestLogKey{}, nil)
			logRequest(logger, c, startedAt)
		}
		// Ayni on geciste istek span'i de bekletildi (tracing.go): son durumla kapanir.
		endPendingSpan(c)
		return written
	}
}

// toAppError, herhangi bir hatayi sozluk koduna indirir.
func toAppError(err error) *apperror.Error {
	var appErr *apperror.Error
	if errors.As(err, &appErr) && apperror.Known(appErr.Code) {
		return appErr
	}

	var fiberErr *fiber.Error
	if errors.As(err, &fiberErr) {
		return &apperror.Error{Code: classify(fiberErr.Code), Cause: err}
	}
	return &apperror.Error{Code: apperror.CodeInternal, Cause: err}
}

// classify, Fiber'in ham HTTP kodunu hata sozlugundeki bir koda indirir.
//
// NEDEN HAM KODU AYNEN DONMUYORUZ: kod -> HTTP eslemesi TEK tablodadir
// (@getir/core/error-codes.ts) ve istemci durumu koddan cozer. Sozlukte
// METHOD_NOT_ALLOWED ya da HEADER_TOO_LARGE yok; "405 + INTERNAL" gibi bir
// cevap hem tabloyu hem istemciyi yaniltir (istemci 5xx gorup yeniden dener).
// Cevaptaki HTTP kodu HER ZAMAN secilen kodun tablodaki karsiligidir:
//
//	404, 405      -> NOT_FOUND          (bu yol + fiil ikilisi yok)
//	diger 4xx     -> VALIDATION_FAILED  (istek bicimsel olarak kabul edilemez)
//	5xx ve digeri -> INTERNAL
//
// Ham kod kaybolmaz: gunlukteki "rawStatus" alaninda durur (errorHandler).
func classify(rawStatus int) apperror.Code {
	switch {
	case rawStatus == http.StatusNotFound || rawStatus == http.StatusMethodNotAllowed:
		return apperror.CodeNotFound
	case rawStatus >= http.StatusBadRequest && rawStatus < http.StatusInternalServerError:
		return apperror.CodeValidationFailed
	default:
		return apperror.CodeInternal
	}
}
