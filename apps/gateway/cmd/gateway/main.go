// gateway, tarayicinin konustugu TEK dis kapidir.
//
// Bugunku sorumlulugu: ayaga kalkmak, bagimli gRPC servislerine baglanti
// havuzu kurmak, /healthz uzerinden durumlarini bildirmek (T3.3), katalog ve
// siparis uclarini sunmak, kimligi kurmak (kayit, giris, JWT; T8.1), mutasyon
// uclarini tekrara karsi korumak (Idempotency-Key, Redis; T8.2) ve sinyalde
// zarifce kapanmak.
//
// Calistirma (zorunlu ortam degiskenleri ve tum tablo: README.md):
//
//	ASSET_BASE_URL=http://localhost:5173 JWT_SECRET="$(openssl rand -hex 32)" MOCK=true go run ./cmd/gateway
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
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/redisdb"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/telemetry"
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
		os.Exit(runHealthcheck(context.Background(), cfg.Port))
	}

	// Istek kapsamindaki satir (InfoContext...) span'in traceId'sini tasir (D15).
	logger := slog.New(telemetry.NewLogHandler(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))).
		With(slog.String("service", "gateway"))
	// Redis surucusunun gunlugu de JSON olsun (baglanti hatalari dahil). Surucu
	// gunlugu paket geneli bir degiskendir: surec basinda, hicbir istemci
	// kurulmadan ONCE bir kez baglanir (sonradan yazmak surucunun arka plan
	// goroutine'leriyle yarisirdi; Linux stres testinde goruldu).
	redisdb.RouteDriverLogs(logger)

	if err := run(cfg, logger); err != nil {
		logger.Error("gateway hatayla kapandi", slog.Any("err", err))
		os.Exit(configFailureExitCode)
	}
}

// run, acilis sirasini tutar: bagla -> dinle -> kapan -> baglantilari birak.
// Havuz, Mongo ve Redis EN SON kapanir: sunucu dururken devam eden istekler
// hala gRPC'yi, Mongo'yu ve Redis'i cagirir.
func run(cfg config.Config, logger *slog.Logger) error {
	// SIGINT/SIGTERM: orkestrator once nazikce ister, sonra oldurur. O pencereyi
	// kullanmazsak devam eden istekler yarida kesilir. Sinyal baglami acilistan
	// ONCE kurulur: Mongo'ya ya da Redis'e baglanirken gelen sinyal acilisi da
	// durdurur.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Izler (D15): adres yoksa olusur ve tasinir, disari gonderilmez.
	tracing, err := telemetry.Setup(ctx, cfg.OTLPEndpoint)
	if err != nil {
		return fmt.Errorf("izleme: %w", err)
	}
	tracing.Install(logger)
	// EN SON (defer sirasi ters): sunucu ve baglantilar kapandiktan sonra
	// bekleyen span'ler gonderilir; sure sinirli, kapanisi uzatmaz.
	defer flushTraces(tracing, logger)

	app, cleanup, err := bootstrap(ctx, cfg, logger, tracing)
	if err != nil {
		return err
	}
	defer cleanup()

	logger.Info("gateway dinlemede",
		slog.Int("port", cfg.Port),
		slog.Bool("mock", cfg.Mock),
		slog.Int("services", len(cfg.Services)),
	)
	return serve(ctx, app, cfg.Addr(), cfg.ShutdownTimeout, logger)
}

// traceFlushTimeout, kapanista bekleyen span'leri gondermek icin taninan en
// uzun sure (Node servisleriyle ayni: 2 sn).
const traceFlushTimeout = 2 * time.Second

// flushTraces, bekleyen span'leri gonderir; hata kapanisi durdurmaz.
func flushTraces(tracing *telemetry.Tracing, logger *slog.Logger) {
	ctx, cancel := context.WithTimeout(context.Background(), traceFlushTimeout)
	defer cancel()
	if err := tracing.Shutdown(ctx); err != nil {
		logger.Warn("izler suresinde gonderilemedi", slog.Any("err", err))
	}
}
