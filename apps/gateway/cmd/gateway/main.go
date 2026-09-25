// gateway, tarayicinin konustugu TEK dis kapidir.
//
// Bugunku sorumlulugu: ayaga kalkmak, bagimli gRPC servislerine baglanti
// havuzu kurmak, /healthz uzerinden durumlarini bildirmek (T3.3), ilk proxy
// ucunu (GET /v1/categories, T3.4) sunmak ve sinyalde zarifce kapanmak.
//
// Calistirma:
//
//	go run ./cmd/gateway            (apps/gateway icinden)
//	curl -s localhost:8080/healthz | jq
//	curl -s localhost:8080/v1/categories | jq
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
)

// Yapilandirma hatasinda donen cikis kodu (Node tarafiyla ayni: 1).
const configFailureExitCode = 1

func main() {
	// Gunluk JSON: konteyner gunlugunu toplayan her arac bu bicimi okur.
	// Seviye yapilandirmadan gelir, o yuzden once gecici bir gunlukcu kurulur.
	bootstrapLogger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load(os.Getenv)
	if err != nil {
		// Eksik yapilandirmayla ayaga kalkip ilk istekte patlamaktansa burada ol.
		bootstrapLogger.Error("yapilandirma gecersiz", slog.Any("err", err))
		os.Exit(configFailureExitCode)
	}

	// Docker HEALTHCHECK bu ikiliyi "gateway healthcheck" diye cagirir.
	if len(os.Args) > 1 && os.Args[1] == healthcheckArg {
		os.Exit(runHealthcheck(cfg.Port))
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel})).
		With(slog.String("service", "gateway"))

	if err := run(cfg, logger); err != nil {
		logger.Error("gateway hatayla kapandi", slog.Any("err", err))
		os.Exit(configFailureExitCode)
	}
}

// run, acilis sirasini tutar: bagla -> dinle -> kapan -> baglantilari birak.
// Havuz EN SON kapanir: sunucu dururken devam eden istekler hala gRPC cagirir.
func run(cfg config.Config, logger *slog.Logger) error {
	app, cleanup, err := bootstrap(cfg, logger)
	if err != nil {
		return err
	}
	defer cleanup()

	// SIGINT/SIGTERM: orkestrator once nazikce ister, sonra oldurur. O pencereyi
	// kullanmazsak devam eden istekler yarida kesilir.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logger.Info("gateway dinlemede",
		slog.Int("port", cfg.Port),
		slog.Bool("mock", cfg.Mock),
		slog.Int("services", len(cfg.Services)),
	)
	return serve(ctx, app, cfg.Addr(), cfg.ShutdownTimeout, logger)
}
