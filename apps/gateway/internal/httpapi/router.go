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

// Deps, yonlendiricinin disaridan aldigi her sey.
type Deps struct {
	Health HealthReporter
	Logger *slog.Logger
}

// New, Fiber uygulamasini kurar.
func New(deps Deps) *fiber.App {
	app := fiber.New(fiber.Config{
		// Kendi zarfimizi yaziyoruz; Fiber'in varsayilan duz metin hatasi
		// sozlesmeyi bozardi.
		ErrorHandler: errorHandler(deps.Logger),
		// Sunucu adini disariya bildirmek gereksiz bilgi sizdirir.
		ServerHeader: "",
	})

	app.Use(requestid.New(requestid.Config{Header: RequestIDHeader}))
	app.Use(requestLogger(deps.Logger))

	app.Get("/healthz", healthzHandler(deps.Health))

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
		return fail(c, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Bagimli servisler hazir degil", report)
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
func errorHandler(logger *slog.Logger) fiber.ErrorHandler {
	return func(c fiber.Ctx, err error) error {
		rawStatus := http.StatusInternalServerError
		var fiberErr *fiber.Error
		if errors.As(err, &fiberErr) {
			rawStatus = fiberErr.Code
		}

		// Ic mesaj istemciye GITMEZ; yalnizca gunluge yazilir. Gunluge Fiber'in
		// HAM kodu gider (405, 431): teshis icin ayrinti orada lazim.
		logger.Error("istek hatayla dondu",
			slog.String("path", c.Path()),
			slog.Int("status", rawStatus),
			slog.String("requestId", requestIDOf(c)),
			slog.Any("err", err),
		)

		mapped := classify(rawStatus)
		return fail(c, mapped.status, mapped.code, mapped.message, nil)
	}
}

// fiberFailure, Fiber'in ham hatasinin sozlesmedeki karsiligi.
type fiberFailure struct {
	status  int
	code    string
	message string
}

// classify, Fiber'in ham HTTP kodunu hata sozlugundeki bir koda indirir.
//
// NEDEN HAM KODU AYNEN DONMUYORUZ: kod -> HTTP eslemesi TEK tablodadir
// (@getir/core/error-codes.ts) ve istemci durumu koddan cozer. Sozlukte
// METHOD_NOT_ALLOWED ya da HEADER_TOO_LARGE yok; "405 + INTERNAL" gibi bir
// cevap hem tabloyu hem istemciyi yaniltir (istemci 5xx gorup yeniden dener).
// Bu yuzden cevaptaki HTTP kodu HER ZAMAN secilen kodun tablodaki karsiligidir:
//
//	404, 405     -> NOT_FOUND 404          (bu yol + fiil ikilisi yok)
//	diger 4xx    -> VALIDATION_FAILED 400  (istek bicimsel olarak kabul edilemez)
//	5xx ve digeri -> INTERNAL 500
func classify(rawStatus int) fiberFailure {
	switch {
	case rawStatus == http.StatusNotFound || rawStatus == http.StatusMethodNotAllowed:
		return fiberFailure{status: http.StatusNotFound, code: "NOT_FOUND", message: "Uc bulunamadi"}
	case rawStatus >= http.StatusBadRequest && rawStatus < http.StatusInternalServerError:
		return fiberFailure{status: http.StatusBadRequest, code: "VALIDATION_FAILED", message: "Istek gecersiz"}
	default:
		return fiberFailure{status: http.StatusInternalServerError, code: "INTERNAL", message: "Beklenmeyen bir hata olustu"}
	}
}

func requestIDOf(c fiber.Ctx) string {
	return requestid.FromContext(c)
}
