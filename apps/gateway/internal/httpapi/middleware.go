package httpapi

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v3"
)

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
