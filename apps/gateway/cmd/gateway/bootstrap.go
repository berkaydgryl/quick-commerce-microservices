package main

import (
	"fmt"
	"log/slog"

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

// bootstrap, parcalari BAGLAR: baglanti havuzu, servis adaptorleri, yonlendirici.
// Dinlemez ve sinyal beklemez; o is serve'undur (Node tarafindaki
// bootstrap.ts / main.ts ayrimi). Yeni bir servis istemcisi (order, payment)
// geldiginde degisen yer burasidir, yasam dongusu degil.
//
// Donen cleanup havuzu kapatir; cagiran, sunucu durduktan SONRA calistirir.
func bootstrap(cfg config.Config, logger *slog.Logger) (*fiber.App, func(), error) {
	targets := make([]clients.Target, 0, len(cfg.Services))
	for _, service := range cfg.Services {
		targets = append(targets, clients.Target{Name: service.Name, Address: service.Address})
	}

	pool, err := clients.NewPool(targets)
	if err != nil {
		return nil, nil, fmt.Errorf("baglanti havuzu: %w", err)
	}
	cleanup := func() {
		if closeErr := pool.Close(); closeErr != nil {
			logger.Warn("baglantilar temiz kapanmadi", slog.Any("err", closeErr))
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

	// Tek katalog adaptoru butun katalog uclarini karsilar; yonlendirici her
	// ucu ayri, dar bir arayuzle gorur (bkz. httpapi.Deps).
	catalogService := catalog.New(
		catalogv1.NewCatalogServiceClient(catalogConn),
		cfg.RequestTimeout,
		assets.NewResolver(cfg.AssetBaseURL),
	)

	app := httpapi.New(httpapi.Deps{
		Health:           health.New(healthClients, cfg.RequestTimeout, cfg.Mock),
		Categories:       catalogService,
		NearbyMarkets:    catalogService,
		Market:           catalogService,
		MarketCategories: catalogService,
		MarketProducts:   catalogService,
		Logger:           logger,
	})

	return app, cleanup, nil
}
