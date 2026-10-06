// Package config, gateway'in ortam degiskenlerini okur ve dogrular.
//
// KURAL (Node tarafiyla ayni): ortam yalnizca BU paketten okunur ve eksik/gecersiz
// deger uygulamayi ACILISTA oldurur. Hatalar tek tek degil TOPLU dondurulur:
// uc degisken birden eksikse gelistirici uc kez yeniden baslatmak zorunda kalmasin.
//
// Dosyalar (D8'de ve D18'de bolundu; her biri tek bir sebeple degisir):
//
//	config.go   - Load (ortamin tamami, tek toplu hata)
//	settings.go - Config ve ServiceTarget tipleri, adres yardimcilari
//	secret.go   - Secret: gunluge ve metne yazilmayan sir
//	features.go - ortama bagli ozellik bayraklari (demo sifre yenileme, telefon degistirme)
//	cards.go    - kart kasasi bayragi ve payment hedefi (T11.17)
//	defaults.go - varsayilanlar ve sabit adlar (port haritasi, NODE_ENV, servisler)
//	env.go      - genel okuyucular: metin, tam sayi, bool, sure, secenek
//	policy.go   - kendi kurali olan okuyucular: gorsel kok adresi, log seviyesi,
//	              Mongo adresi, JWT sirri (T8.1), Redis adresi (T8.2), harita
//	              adres servisi (T11.8), SMTP adresi ve gonderen (T11.14)
//	seed.go     - persona seed komutunun dar yapilandirmasi (T8.1)
package config

import (
	"errors"
	"fmt"
)

// Getenv, ortam okuyucusudur. Testte sahte bir fonksiyon verilir; boylece
// testler gercek ortami kirletmez ve paralel kosabilir.
type Getenv func(string) string

// Load, ortami okur ve dogrular. Birden fazla sorun varsa hepsi tek hatada birlesir.
func Load(getenv Getenv) (Config, error) {
	var problems []error

	port, err := readInt(getenv, "GATEWAY_PORT", defaultPort, minPort, maxGatewayPort)
	if err != nil {
		problems = append(problems, err)
	}

	level, err := readLogLevel(getenv)
	if err != nil {
		problems = append(problems, err)
	}

	mock, err := readBool(getenv, "MOCK", false)
	if err != nil {
		problems = append(problems, err)
	}

	shutdownTimeout, err := readDuration(getenv, "GRPC_SHUTDOWN_TIMEOUT_MS", defaultShutdownTimeout)
	if err != nil {
		problems = append(problems, err)
	}

	requestTimeout, err := readDuration(getenv, "GATEWAY_REQUEST_TIMEOUT_MS", defaultRequestTimeout)
	if err != nil {
		problems = append(problems, err)
	}

	stockTimeout, err := readDuration(getenv, "GATEWAY_STOCK_TIMEOUT_MS", defaultStockTimeout)
	if err != nil {
		problems = append(problems, err)
	}

	nodeEnv, err := readEnum(getenv, "NODE_ENV", EnvDevelopment, []string{EnvDevelopment, EnvTest, EnvProduction})
	if err != nil {
		problems = append(problems, err)
	}

	assetBaseURL, err := readBaseURL(getenv, "ASSET_BASE_URL")
	if err != nil {
		problems = append(problems, err)
	}

	otlpEndpoint, err := readOptionalHTTPURL(getenv, "OTEL_EXPORTER_OTLP_ENDPOINT")
	if err != nil {
		problems = append(problems, err)
	}

	// Kimlik (T8.1): Mongo MOCK disinda zorunlu, sir her zaman zorunlu.
	mongoURI, err := readMongoURI(getenv, mock)
	if err != nil {
		problems = append(problems, err)
	}

	mongoTimeout, err := readDuration(getenv, "MONGO_SERVER_SELECTION_TIMEOUT_MS", defaultMongoServerSelectionTimeout)
	if err != nil {
		problems = append(problems, err)
	}

	jwtSecret, err := readJWTSecret(getenv, nodeEnv)
	if err != nil {
		problems = append(problems, err)
	}

	// Oda jetonu (T12.2): ayri sir, JWT_SECRET'tan farkli olmali.
	realtimeTokenSecret, err := readRealtimeTokenSecret(getenv, nodeEnv, jwtSecret)
	if err != nil {
		problems = append(problems, err)
	}

	jwtTTL, err := readSeconds(getenv, "JWT_TTL", defaultJWTTTL)
	if err != nil {
		problems = append(problems, err)
	}

	refreshTTL, err := readSeconds(getenv, "REFRESH_TTL", defaultRefreshTTL)
	if err != nil {
		problems = append(problems, err)
	}

	// Tekrar korumasi (T8.2): Redis MOCK disinda zorunlu.
	redisURL, err := readRedisURL(getenv, mock)
	if err != nil {
		problems = append(problems, err)
	}

	redisConnectTimeout, err := readDuration(getenv, "REDIS_CONNECT_TIMEOUT_MS", defaultRedisConnectTimeout)
	if err != nil {
		problems = append(problems, err)
	}

	idempotencyTTL, err := readSeconds(getenv, "IDEMPOTENCY_TTL_SECONDS", defaultIdempotencyTTL)
	if err != nil {
		problems = append(problems, err)
	}

	// Hiz siniri (T8.2, P2): varsayilanlar .env.example ile ayni.
	rateLimitEnabled, err := readBool(getenv, "RATE_LIMIT_ENABLED", true)
	if err != nil {
		problems = append(problems, err)
	}

	rateLimitWindow, err := readSeconds(getenv, "RATE_LIMIT_WINDOW_SECONDS", defaultRateLimitWindow)
	if err != nil {
		problems = append(problems, err)
	}

	rateLimitGeneral, err := readInt(getenv, "RATE_LIMIT_MAX_REQUESTS", defaultRateLimitGeneral, 1, maxRateLimit)
	if err != nil {
		problems = append(problems, err)
	}

	rateLimitAuth, err := readInt(getenv, "RATE_LIMIT_AUTH_MAX_REQUESTS", defaultRateLimitAuth, 1, maxRateLimit)
	if err != nil {
		problems = append(problems, err)
	}

	rateLimitOrder, err := readInt(getenv, "RATE_LIMIT_ORDER_MAX_REQUESTS", defaultRateLimitOrder, 1, maxRateLimit)
	if err != nil {
		problems = append(problems, err)
	}

	// Harita adres servisi (T11.8): varsayilan OpenStreetMap'in genel sunucusu.
	geoBaseURL, err := readGeoBaseURL(getenv)
	if err != nil {
		problems = append(problems, err)
	}

	geoTimeout, err := readDuration(getenv, "GEO_TIMEOUT_MS", defaultGeoTimeout)
	if err != nil {
		problems = append(problems, err)
	}

	// E-posta dogrulama (T11.14): gelistirmede varsayilan Mailpit.
	smtpAddress, err := readSMTPAddress(getenv, mock, nodeEnv)
	if err != nil {
		problems = append(problems, err)
	}

	mailFrom, err := readMailFrom(getenv)
	if err != nil {
		problems = append(problems, err)
	}

	smtpTimeout, err := readDuration(getenv, "SMTP_TIMEOUT_MS", defaultSMTPTimeout)
	if err != nil {
		problems = append(problems, err)
	}

	// Servis listesi sabittir: gateway'in dogrudan konustugu uc servis (stok
	// T8.4'ten beri). Yeni servis geldiginde buraya bir satir eklenir; adres yine
	// ortamdan gelir. /healthz listedeki her servisi yoklar.
	services := []ServiceTarget{
		{Name: CatalogService, Address: readString(getenv, "CATALOG_GRPC_ADDR", defaultCatalogAddress)},
		{Name: InventoryService, Address: readString(getenv, "INVENTORY_GRPC_ADDR", defaultInventoryAddress)},
		{Name: OrderService, Address: readString(getenv, "ORDER_GRPC_ADDR", defaultOrderAddress)},
	}
	services = append(services, cardVaultTargets(getenv, nodeEnv)...) // T11.17, cards.go

	if len(problems) > 0 {
		return Config{}, fmt.Errorf("ortam degiskenleri gecersiz: %w", errors.Join(problems...))
	}

	return Config{
		Port:                        port,
		NodeEnv:                     nodeEnv,
		LogLevel:                    level,
		Mock:                        mock,
		ShutdownTimeout:             shutdownTimeout,
		RequestTimeout:              requestTimeout,
		StockTimeout:                stockTimeout,
		Services:                    services,
		AssetBaseURL:                assetBaseURL,
		OTLPEndpoint:                otlpEndpoint,
		MongoURI:                    mongoURI,
		MongoDB:                     readString(getenv, "GATEWAY_MONGO_DB", defaultMongoDB),
		MongoServerSelectionTimeout: mongoTimeout,
		JWTSecret:                   jwtSecret,
		RealtimeTokenSecret:         realtimeTokenSecret,
		JWTTTL:                      jwtTTL,
		RefreshTTL:                  refreshTTL,
		RedisURL:                    redisURL,
		RedisConnectTimeout:         redisConnectTimeout,
		IdempotencyTTL:              idempotencyTTL,
		RateLimitEnabled:            rateLimitEnabled,
		RateLimitWindow:             rateLimitWindow,
		RateLimitGeneral:            rateLimitGeneral,
		RateLimitAuth:               rateLimitAuth,
		RateLimitOrder:              rateLimitOrder,
		GeoBaseURL:                  geoBaseURL,
		GeoUserAgent:                readString(getenv, "GEO_USER_AGENT", defaultGeoUserAgent),
		GeoTimeout:                  geoTimeout,
		SMTPAddress:                 smtpAddress,
		MailFrom:                    mailFrom,
		SMTPTimeout:                 smtpTimeout,
	}, nil
}
