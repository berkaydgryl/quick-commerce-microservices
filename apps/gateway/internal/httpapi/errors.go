package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// errorHandler, yakalanmamis her hatayi tek zarfa cevirir.
//
// Iki kaynak vardir: bizim urettigimiz *apperror.Error (dogrulama, bagimli
// servis hatasi) ve Fiber'in kendi hatalari (bilinmeyen yol, yanlis fiil).
// Ikisi de sozlukteki bir koda iner; ic mesaj ve sebep istemciye GITMEZ,
// yalnizca gunluge yazilir.
func errorHandler(logger *slog.Logger) fiber.ErrorHandler {
	return func(c fiber.Ctx, err error) error {
		appErr := toAppError(err)

		// 4xx istemcinin hatasidir, gateway'in degil: ERROR seviyesi alarm
		// gurultusu uretirdi.
		level := slog.LevelWarn
		if apperror.HTTPStatus(appErr.Code) >= http.StatusInternalServerError {
			level = slog.LevelError
		}
		logger.Log(c.Context(), level, "istek hatayla dondu",
			slog.String("path", c.Path()),
			slog.String("code", string(appErr.Code)),
			slog.String("requestId", requestIDOf(c)),
			slog.Any("err", err),
		)

		// nil harita "details": {} degil, alan yok olarak cikmali.
		var details any
		if len(appErr.Details) > 0 {
			details = appErr.Details
		}
		return fail(c, appErr.Code, details)
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
// Ham kod kaybolmaz: gunlukteki "err" alaninda durur.
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
