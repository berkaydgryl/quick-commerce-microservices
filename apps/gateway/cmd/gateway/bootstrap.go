package main

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"google.golang.org/grpc/health/grpc_health_v1"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"
	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/assets"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/clients"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/health"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/httpapi"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
)

// bootstrap, parcalari BAGLAR: baglanti havuzu, kimlik servisi (T8.1), tekrar
// korumasi ve hiz siniri (T8.2), servis adaptorleri, yonlendirici. Dinlemez ve sinyal beklemez; o is serve'undur
// (Node tarafindaki bootstrap.ts / main.ts ayrimi). Yeni bir servis istemcisi
// (order, payment) geldiginde degisen yer burasidir, yasam dongusu degil.
//
// ctx acilisin baglamidir: Mongo'ya ya da Redis'e baglanirken sinyal gelirse
// acilis durur. Donen cleanup havuzu, Mongo ve Redis baglantilarini kapatir;
// cagiran, sunucu durduktan SONRA calistirir.
func bootstrap(ctx context.Context, cfg config.Config, logger *slog.Logger) (*fiber.App, func(), error) {
	targets := make([]clients.Target, 0, len(cfg.Services))
	for _, service := range cfg.Services {
		targets = append(targets, clients.Target{Name: service.Name, Address: service.Address})
	}

	pool, err := clients.NewPool(targets)
	if err != nil {
		return nil, nil, fmt.Errorf("baglanti havuzu: %w", err)
	}
	closePool := func() {
		if closeErr := pool.Close(); closeErr != nil {
			logger.Warn("baglantilar temiz kapanmadi", slog.Any("err", closeErr))
		}
	}

	identity, err := buildAuth(ctx, cfg, auth.DefaultPasswordCost)
	if err != nil {
		closePool()
		return nil, nil, fmt.Errorf("kimlik: %w", err)
	}
	if identity.personas > 0 {
		logger.Info("demo personalari bellege yuklendi (MOCK)", slog.Int("hesap", identity.personas))
	}
	// Kapanista ctx coktan iptal edilmistir (sinyal); Mongo'yu birakmak icin
	// iptali tasimayan, kapanis suresiyle sinirli yeni bir baglam kurulur.
	closeIdentity := func() {
		closeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cfg.ShutdownTimeout)
		defer cancel()
		if closeErr := identity.close(closeCtx); closeErr != nil {
			logger.Warn("mongo baglantisi temiz kapanmadi", slog.Any("err", closeErr))
		}
	}

	// Tek Redis baglantisi: tekrar korumasi ve hiz siniri paylasir (T8.2).
	shared, err := buildRedis(ctx, cfg)
	if err != nil {
		closePool()
		closeIdentity()
		return nil, nil, fmt.Errorf("redis (tekrar korumasi, hiz siniri): %w", err)
	}
	cleanup := func() {
		closePool()
		closeIdentity()
		if closeErr := shared.close(); closeErr != nil {
			logger.Warn("redis baglantisi temiz kapanmadi", slog.Any("err", closeErr))
		}
	}

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
		cleanup()
		return nil, nil, fmt.Errorf("%s baglantisi havuzda yok", config.CatalogService)
	}
	orderConn, ok := pool.Conn(config.OrderService)
	if !ok {
		cleanup()
		return nil, nil, fmt.Errorf("%s baglantisi havuzda yok", config.OrderService)
	}

	// Tek katalog adaptoru butun katalog uclarini karsilar; yonlendirici her
	// ucu ayri, dar bir arayuzle gorur (bkz. httpapi.Deps).
	catalogService := catalog.New(
		catalogv1.NewCatalogServiceClient(catalogConn),
		cfg.RequestTimeout,
		assets.NewResolver(cfg.AssetBaseURL),
	)

	// Tek siparis adaptoru dort siparis ucunu karsilar (T7.5).
	orderService := order.New(orderv1.NewOrderServiceClient(orderConn), cfg.RequestTimeout)

	app := httpapi.New(httpapi.Deps{
		Health:           health.New(healthClients, mergePingers(identity.pingers, shared.pingers), cfg.RequestTimeout, cfg.Mock),
		Categories:       catalogService,
		NearbyMarkets:    catalogService,
		Market:           catalogService,
		MarketCategories: catalogService,
		MarketProducts:   catalogService,
		CartReserver:     orderService,
		OrderPlacer:      orderService,
		ThreeDSConfirmer: orderService,
		OrderGetter:      orderService,
		// Tek kimlik servisi bes kimlik ucunu karsilar (T8.1).
		UserRegistrar:     identity.service,
		UserAuthenticator: identity.service,
		SessionRefresher:  identity.service,
		SessionRevoker:    identity.service,
		ProfileGetter:     identity.service,
		CheckoutSignals:   identity.service,
		AccessTokens:      identity.tokens,
		// Tekrar korumasi ve hiz siniri (T8.2): Redis ya da MOCK'ta bellek.
		Idempotency: buildIdempotency(cfg, shared.client),
		RateLimit:   buildRateLimit(cfg, shared.client),
		// Cihaz cerezi yalnizca production'da Secure: gelistirme http://localhost.
		SecureCookies: cfg.NodeEnv == config.EnvProduction,
		Logger:        logger,
	})

	return app, cleanup, nil
}

// mergePingers, gRPC disi bagimliliklari tek haritada toplar (Mongo, Redis).
func mergePingers(groups ...map[string]health.Pinger) map[string]health.Pinger {
	merged := map[string]health.Pinger{}
	for _, group := range groups {
		for name, pinger := range group {
			merged[name] = pinger
		}
	}
	return merged
}
