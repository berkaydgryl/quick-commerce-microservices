package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/requestid"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/health"
)

// Korelasyon kimliginin tasindigi baslik. Node servisleri ayni adi kullanir
// (service-kit: REQUEST_ID_METADATA_KEY), boylece tek istek uctan uca izlenir.
const RequestIDHeader = "X-Request-ID"

// HealthReporter, /healthz ucunun ihtiyaci olan tek davranis.
//
// Arayuz KULLANAN tarafta ve tek metotlu: testte sahte bir rapor dondurmek icin
// gercek gRPC istemcisi kurmak gerekmiyor.
type HealthReporter interface {
	Check(ctx context.Context) health.Report
}

// CategoryLister, GET /v1/categories ucunun ihtiyaci olan tek davranis.
type CategoryLister interface {
	ListCategories(ctx context.Context) (catalog.CategoryList, error)
}

// Deps, yonlendiricinin disaridan aldigi her sey.
type Deps struct {
	Health     HealthReporter
	Categories CategoryLister
	Logger     *slog.Logger
}

// New, Fiber uygulamasini kurar.
func New(deps Deps) *fiber.App {
	app := fiber.New(fiber.Config{
		// Kendi zarfimizi yaziyoruz; Fiber'in varsayilan duz metin hatasi
		// sozlesmeyi bozardi.
		ErrorHandler: errorHandler(deps.Logger),
		// Sunucu adini disariya bildirmek gereksiz bilgi sizdirir.
		ServerHeader: "",
		JSONEncoder:  encodeJSON,
	})

	app.Use(requestid.New(requestid.Config{Header: RequestIDHeader}))
	app.Use(requestLogger(deps.Logger))

	app.Get("/healthz", healthzHandler(deps.Health))

	v1 := app.Group("/v1")
	v1.Get("/categories", listCategoriesHandler(deps.Categories))

	return app
}

// healthzHandler, bagimli servislerin durumunu doner.
//
// HTTP KODU SOZLESMESI: hepsi ayaktaysa 200, biri bile degilse 503. Probe'lar
// govdeyi degil kodu okur; insan ve panolar govdedeki servis listesini okur.
func healthzHandler(reporter HealthReporter) fiber.Handler {
	return func(c fiber.Ctx) error {
		report := reporter.Check(c.Context())
		if report.Healthy() {
			return ok(c, http.StatusOK, report)
		}
		return fail(c, apperror.CodeServiceUnavailable, report)
	}
}

// requestLogger, her istegi yapilandirilmis olarak gunluge yazar.
func requestLogger(logger *slog.Logger) fiber.Handler {
	return func(c fiber.Ctx) error {
		startedAt := time.Now()

		// Hata BURADA cevaba cevrilir, gunluk ondan sonra yazilir. Aksi halde
		// hata yukari tasinip ErrorHandler'da cevaplanir ve bu satir henuz
		// yazilmamis durumu (200) gunluge gecirirdi: 405 donen istek logda 200
		// gorunurdu. Fiber'in kendi logger ara katmani da ayni yolu izler.
		if err := c.Next(); err != nil {
			if handlerErr := c.App().ErrorHandler(c, err); handlerErr != nil {
				return fmt.Errorf("hata cevabi yazilamadi: %w", handlerErr)
			}
		}

		logger.Info("http istegi",
			slog.String("method", c.Method()),
			slog.String("path", c.Path()),
			slog.Int("status", c.Response().StatusCode()),
			slog.Int64("durationMs", time.Since(startedAt).Milliseconds()),
			slog.String("requestId", requestIDOf(c)),
		)
		return nil
	}
}

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

func requestIDOf(c fiber.Ctx) string {
	return requestid.FromContext(c)
}
