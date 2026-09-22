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
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/gofiber/fiber/v3"
	"google.golang.org/grpc/health/grpc_health_v1"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/assets"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/clients"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/health"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/httpapi"
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

func run(cfg config.Config, logger *slog.Logger) error {
	targets := make([]clients.Target, 0, len(cfg.Services))
	for _, service := range cfg.Services {
		targets = append(targets, clients.Target{Name: service.Name, Address: service.Address})
	}

	pool, err := clients.NewPool(targets)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := pool.Close(); closeErr != nil {
			logger.Warn("baglantilar temiz kapanmadi", slog.Any("err", closeErr))
		}
	}()

	healthClients := make(map[string]health.Client, len(targets))
	for _, target := range targets {
		conn, ok := pool.Conn(target.Name)
		if !ok {
			continue
		}
		healthClients[target.Name] = grpc_health_v1.NewHealthClient(conn)
	}

	catalogConn, ok := pool.Conn(config.CatalogService)
	if !ok {
		return fmt.Errorf("%s baglantisi havuzda yok", config.CatalogService)
	}

	app := httpapi.New(httpapi.Deps{
		Health: health.New(healthClients, cfg.RequestTimeout, cfg.Mock),
		Categories: catalog.New(
			catalogv1.NewCatalogServiceClient(catalogConn),
			cfg.RequestTimeout,
			assets.NewResolver(cfg.AssetBaseURL),
		),
		Logger: logger,
	})

	// SIGINT/SIGTERM: orkestrator once nazikce ister, sonra oldurur. O pencereyi
	// kullanmazsak devam eden istekler yarida kesilir.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	serverErr := make(chan error, 1)
	go func() {
		logger.Info("gateway dinlemede",
			slog.Int("port", cfg.Port),
			slog.Bool("mock", cfg.Mock),
			slog.Int("services", len(targets)),
		)
		serverErr <- app.Listen(cfg.Addr(), fiber.ListenConfig{DisableStartupMessage: true})
	}()

	select {
	case err := <-serverErr:
		return err
	case <-ctx.Done():
		logger.Info("kapanis sinyali alindi", slog.Int64("timeoutMs", cfg.ShutdownTimeout.Milliseconds()))
		// Devam eden istekler bitsin; sure dolarsa Fiber baglantilari keser.
		if err := app.ShutdownWithTimeout(cfg.ShutdownTimeout); err != nil {
			return err
		}
		logger.Info("gateway kapandi")
		return nil
	}
}
