package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v3"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health/grpc_health_v1"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"
	inventoryv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/inventory/v1"
	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/assets"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/clients"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/content"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/geo"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/health"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/httpapi"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/inventory"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/roomtoken"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rpc"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/storefront"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/telemetry"
)

// bootstrap, parcalari BAGLAR: baglanti havuzu, kimlik servisi (T8.1), tekrar
// korumasi ve hiz siniri (T8.2), servis adaptorleri, yonlendirici. Dinlemez ve sinyal beklemez; o is serve'undur
// (Node tarafindaki bootstrap.ts / main.ts ayrimi). Yeni bir servis istemcisi
// (order, payment) geldiginde degisen yer burasidir, yasam dongusu degil.
//
// ctx acilisin baglamidir: Mongo'ya ya da Redis'e baglanirken sinyal gelirse
// acilis durur. Donen cleanup havuzu, Mongo ve Redis baglantilarini kapatir;
// cagiran, sunucu durduktan SONRA calistirir.
func bootstrap(ctx context.Context, cfg config.Config, logger *slog.Logger, tracing *telemetry.Tracing, recorder httpapi.RequestMetrics) (*fiber.App, func(), error) {
	// Ekran icerigi (T11.6) baglantilardan ONCE: gomulu dosya bozuksa
	// acilacak, sonra kapatilacak bir sey yoktur.
	images := assets.NewResolver(cfg.AssetBaseURL)
	welcome, err := content.LoadWelcome(images)
	if err != nil {
		return nil, nil, fmt.Errorf("icerik: %w", err)
	}

	targets := make([]clients.Target, 0, len(cfg.Services))
	for _, service := range cfg.Services {
		targets = append(targets, clients.Target{Name: service.Name, Address: service.Address})
	}

	// Giden her gRPC cagrisi istemci span'i acar ve traceparent'i tasir (D15).
	pool, err := clients.NewPool(targets,
		grpc.WithChainUnaryInterceptor(rpc.TracingInterceptor(tracing.Tracer, tracing.Propagator)))
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
	inventoryConn, ok := pool.Conn(config.InventoryService)
	if !ok {
		cleanup()
		return nil, nil, fmt.Errorf("%s baglantisi havuzda yok", config.InventoryService)
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
		images,
	)

	// Urun listesi ve genel arama katalog + stoktur (T8.4, B27; T9.6): stok
	// sorgusunun kendi, kisa siniri var; stok gelmezse urunler stoksuz doner.
	stock := inventory.New(inventoryv1.NewInventoryServiceClient(inventoryConn), cfg.StockTimeout)
	products := storefront.NewProducts(catalogService, stock, logger)
	search := storefront.NewSearch(catalogService, stock, logger)

	// Tek siparis adaptoru dort siparis ucunu karsilar (T7.5).
	orderService := order.New(orderv1.NewOrderServiceClient(orderConn), cfg.RequestTimeout)

	// Siparis odasi jetonu (T12.2): sahiplik order GetOrder'la denetlenir, jeton
	// erisim jetonundan ayri sirla imzalanir (realtime ayni sirla dogrular).
	roomTokens := roomtoken.NewService(
		func(ctx context.Context, userID, orderID string) error {
			_, err := orderService.Get(ctx, userID, orderID)
			return err
		},
		roomtoken.NewSigner(cfg.RealtimeTokenSecret.Bytes(), time.Now),
	)

	// Harita adres servisi (T11.8): Nominatim'e tek sira ve onbellekle gider.
	places := geo.New(geo.Options{BaseURL: cfg.GeoBaseURL, UserAgent: cfg.GeoUserAgent, Timeout: cfg.GeoTimeout})

	// Demo sifre yenileme (T11.9): production'da uc hic baglanmaz.
	var passwordResetter httpapi.PasswordResetter
	if cfg.DemoPasswordReset() {
		passwordResetter = identity.service
	}

	app := httpapi.New(httpapi.Deps{
		Health:              health.New(healthClients, mergePingers(identity.pingers, shared.pingers), cfg.RequestTimeout, cfg.Mock, logger),
		Categories:          catalogService,
		WelcomeContent:      content.NewStatic(welcome),
		NearbyMarkets:       catalogService,
		Market:              catalogService,
		MarketCategories:    catalogService,
		MarketProducts:      products,
		NearbySearch:        search,
		CartReserver:        orderService,
		ReservationReleaser: orderService,
		OrderPlacer:         orderService,
		ThreeDSConfirmer:    orderService,
		OrderGetter:         orderService,
		OrderRoomTokens:     roomTokens,
		// Tek kimlik servisi bes kimlik ucunu karsilar (T8.1).
		UserRegistrar:     identity.service,
		UserAuthenticator: identity.service,
		PhoneChecker:      identity.service,
		PasswordResetter:  passwordResetter,
		SessionRefresher:  identity.service,
		SessionRevoker:    identity.service,
		ProfileGetter:     identity.service,
		AddressBook:       identity.service,
		AddressAdder:      identity.service,
		CheckoutSignals:   identity.service,
		AccessTokens:      identity.tokens,
		GeoReverser:       places,
		GeoSearcher:       places,
		// Tekrar korumasi ve hiz siniri (T8.2): Redis ya da MOCK'ta bellek.
		Idempotency: buildIdempotency(cfg, shared.client),
		RateLimit:   buildRateLimit(cfg, shared.client),
		// Cihaz cerezi yalnizca production'da Secure: gelistirme http://localhost.
		SecureCookies: cfg.NodeEnv == config.EnvProduction,
		Logger:        logger,
		// Istek span'leri (D15).
		Tracer:     tracing.Tracer,
		Propagator: tracing.Propagator,
		Metrics:    recorder,
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
