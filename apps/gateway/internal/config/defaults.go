package config

import (
	"log/slog"
	"time"
)

// Varsayilanlar. Roadmap'teki port haritasi ile birebir ayni.
const (
	defaultPort             = 8080
	defaultCatalogAddress   = "localhost:50051"
	defaultInventoryAddress = "localhost:50052"
	defaultOrderAddress     = "localhost:50053"
	defaultShutdownTimeout  = 10 * time.Second
	defaultRequestTimeout   = 5 * time.Second
	// GATEWAY_STOCK_TIMEOUT_MS=300 (T8.4): stok sorgusu tek Redis okumasidir;
	// asilirsa urun listesi stoksuz doner, genel sinir (5 sn) kadar beklenmez.
	defaultStockTimeout = 300 * time.Millisecond
	defaultLogLevel     = slog.LevelInfo
)

// Kimlik ve Mongo varsayilanlari (T8.1). Adlar ve degerler .env.example ile ayni.
const (
	// defaultMongoDB, gateway'in KENDI veritabani (D14, ADR-05): GATEWAY_MONGO_DB
	// verilmezse. Kullanicisi (GATEWAY_MONGO_URI) yalnizca burada yetkilidir.
	defaultMongoDB                     = "getir_gateway"
	defaultMongoServerSelectionTimeout = 5 * time.Second
	// JWT_TTL=3600 (ADR-12): erisim jetonu 1 saat.
	defaultJWTTTL = time.Hour
	// REFRESH_TTL=1209600: yenileme jetonu 14 gun.
	defaultRefreshTTL = 14 * 24 * time.Hour
	// minJWTSecretBytes: HS256 icin daha kisa sir kaba kuvvete aciktir.
	minJWTSecretBytes = 32
	// exampleJWTSecret, .env.example'daki ornek sir: production'da REDDEDILIR.
	exampleJWTSecret = "dev-only-insecure-secret-change-me"
	// exampleRealtimeTokenSecret, .env.example'daki ornek oda jetonu sirri (T12.2):
	// production'da REDDEDILIR. realtime-service'in EXAMPLE_TOKEN_SECRET'i ile ayni.
	exampleRealtimeTokenSecret = "dev-only-insecure-realtime-secret-change-me"
)

// Redis ve tekrar korumasi varsayilanlari (T8.2). Adlar ve degerler .env.example ile ayni.
const (
	// REDIS_CONNECT_TIMEOUT_MS=5000: Redis kapaliysa acilista hizlica ol.
	defaultRedisConnectTimeout = 5 * time.Second
	// IDEMPOTENCY_TTL_SECONDS=86400: bitmis kaydin omru (ADR-08); basarili
	// siparisin kaydi 2 saattir (ADR-08 eki, httpapi).
	defaultIdempotencyTTL = 24 * time.Hour
)

// Hiz siniri varsayilanlari (T8.2, roadmap P2). Adlar ve degerler .env.example ile ayni.
const (
	// RATE_LIMIT_WINDOW_SECONDS=60: kayan pencerenin uzunlugu.
	defaultRateLimitWindow = time.Minute
	// RATE_LIMIT_MAX_REQUESTS=120: genel sinir (katalog, market, profil, siparis okuma).
	defaultRateLimitGeneral = 120
	// RATE_LIMIT_AUTH_MAX_REQUESTS=10: kayit ve giris (kaba kuvvet savunmasi).
	defaultRateLimitAuth = 10
	// RATE_LIMIT_ORDER_MAX_REQUESTS=20: rezervasyon, siparis ve 3DS.
	defaultRateLimitOrder = 20
	// maxRateLimit, pencere basina en buyuk sinir. Sayac yalnizca kabul edilen
	// istekleri tutar: bu deger bir sayacin Redis'teki en buyuk boyutudur.
	maxRateLimit = 10000
)

// Harita adres servisi varsayilanlari (T11.8). Adlar ve degerler .env.example ile ayni.
const (
	// GEO_BASE_URL: OpenStreetMap'in genel Nominatim sunucusu (ucretsiz;
	// saniyede en fazla bir istek, gateway siraya dizer).
	defaultGeoBaseURL = "https://nominatim.openstreetmap.org"
	// GEO_USER_AGENT: Nominatim kosulu geregi uygulamayi tanitan ad.
	defaultGeoUserAgent = "getir-demo-gateway/1.0 (+https://github.com/berkaydgryl/quick-commerce-microservices)"
	// GEO_TIMEOUT_MS=5000: sirada bekleme dahil tek sorunun ust siniri.
	defaultGeoTimeout = 5 * time.Second
)

// E-posta gonderimi varsayilanlari (T11.14). Adlar ve degerler .env.example ile ayni.
const (
	// SMTP_URL: gelistirmede compose'daki Mailpit (arayuzu localhost:8025).
	// Production'da varsayilan YOK: adres acikca verilir.
	defaultSMTPURL = "smtp://localhost:1025"
	// MAIL_FROM: dogrulama iletisinin gondereni.
	defaultMailFrom = "getir <no-reply@getir.local>"
	// SMTP_TIMEOUT_MS=5000: tek iletinin ust siniri (baglanti + teslim).
	defaultSMTPTimeout = 5 * time.Second
)

// NODE_ENV degerleri (Node servisleriyle ayni sozluk). Production, gelistirme
// kolayliklarinin KAPALI oldugu tek ortamdir (ornek sir reddedilir, T8.1).
const (
	EnvDevelopment = "development"
	EnvTest        = "test"
	EnvProduction  = "production"
)

// Servis adlari: havuzdaki anahtar, gunluk alani ve /healthz'deki "name".
// Tek yerde tanimli; main ayni adla havuzdan baglanti ister.
const (
	CatalogService   = "catalog"
	InventoryService = "inventory"
	OrderService     = "order"
)

const (
	minPort = 1
	maxPort = 65535
	// MetricsPortOffset, metrik ucunun portu: GATEWAY_PORT + 1000 (roadmap port
	// kurali; Node servislerinde gRPC portu + 1000, T10.5). #29.
	MetricsPortOffset = 1000
	// maxGatewayPort, metrik portu da gecerli kalsin diye gateway portunun ust siniri.
	maxGatewayPort = maxPort - MetricsPortOffset
)
