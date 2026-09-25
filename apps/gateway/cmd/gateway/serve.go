package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v3"
)

// serve, yasam dongusunu yurutur: dinlemeye baslar, ctx iptal edilene kadar
// bekler, sonra devam eden isteklerin bitmesine shutdownTimeout kadar izin verir.
// Hangi uclarin oldugunu bilmez; o is bootstrap'indir.
//
// ctx disaridan gelir (main'de SIGINT/SIGTERM'e bagli); testte elle iptal edilir.
func serve(ctx context.Context, app *fiber.App, addr string, shutdownTimeout time.Duration, logger *slog.Logger) error {
	serverErr := make(chan error, 1)
	go func() {
		serverErr <- app.Listen(addr, fiber.ListenConfig{DisableStartupMessage: true})
	}()

	select {
	case err := <-serverErr:
		return fmt.Errorf("http sunucusu (%s): %w", addr, err)
	case <-ctx.Done():
		logger.Info("kapanis sinyali alindi", slog.Int64("timeoutMs", shutdownTimeout.Milliseconds()))
		// Devam eden istekler bitsin; sure dolarsa Fiber baglantilari keser.
		if err := app.ShutdownWithTimeout(shutdownTimeout); err != nil {
			return fmt.Errorf("zarif kapanis: %w", err)
		}
		logger.Info("gateway kapandi")
		return nil
	}
}
