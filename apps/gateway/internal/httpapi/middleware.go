package httpapi

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v3"
)

// pendingRequestLogKey, istek satiri hata isleyiciye birakildiginda baslangic
// anini tasir (asagida: Fiber'in sunucu hatasi on gecisi). Disariya kapali tip,
// baska bir paketin anahtariyla carpismaz.
type pendingRequestLogKey struct{}

// requestLogger, her istegi yapilandirilmis olarak gunluge yazar.
func requestLogger(logger *slog.Logger) fiber.Handler {
	return func(c fiber.Ctx) error {
		startedAt := time.Now()

		// Hata BURADA cevaba cevrilir, gunluk ondan sonra yazilir. Aksi halde
		// hata yukari tasinip ErrorHandler'da cevaplanir ve bu satir henuz
		// yazilmamis durumu (200) gunluge gecirirdi: 405 donen istek logda 200
		// gorunurdu. Fiber'in kendi logger ara katmani da ayni yolu izler.
		err := c.Next()
		if err != nil {
			if handlerErr := c.App().ErrorHandler(c, err); handlerErr != nil {
				return fmt.Errorf("hata cevabi yazilamadi: %w", handlerErr)
			}
		} else if !c.Matched() {
			// Fiber'in sunucu hatasi on gecisi (T8.3; govde siniri, zaman
			// asimi): Fiber bu hatalarda once Use ara katmanlarini rota
			// isleyicisi OLMADAN calistirir, cevabi SONRA hata isleyici yazar.
			// Burada yazilan satir 200 derdi (canli testte bulundu); satiri
			// hata isleyici son durumla yazar (errors.go). Use zincirimizde
			// cevabi kendisi yazip zinciri kesen ara katman yoktur; eklenirse
			// bu kural gozden gecirilir (envelope_test.go her istekte tek
			// satir bekler).
			c.Locals(pendingRequestLogKey{}, startedAt)
			return nil
		}
		logRequest(logger, c, startedAt)
		return nil
	}
}

// logRequest, istek satirini cevabin SON durumuyla yazar.
func logRequest(logger *slog.Logger, c fiber.Ctx, startedAt time.Time) {
	// Baglamla: istek span'inin traceId'si satira eklenir (D15, telemetry).
	logger.InfoContext(c.Context(), "http istegi",
		slog.String("method", c.Method()),
		slog.String("path", c.Path()),
		slog.Int("status", c.Response().StatusCode()),
		slog.Int64("durationMs", time.Since(startedAt).Milliseconds()),
		slog.String("requestId", requestIDOf(c)),
	)
}
