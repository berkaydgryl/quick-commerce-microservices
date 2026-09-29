// Package config, gateway'in ortam degiskenlerini okur ve dogrular.
//
// KURAL (Node tarafiyla ayni): ortam yalnizca BU paketten okunur ve eksik/gecersiz
// deger uygulamayi ACILISTA oldurur. Hatalar tek tek degil TOPLU dondurulur:
// uc degisken birden eksikse gelistirici uc kez yeniden baslatmak zorunda kalmasin.
//
// Dosyalar (D8'de bolundu; her biri tek bir sebeple degisir):
//
//	config.go   - Config tipi ve Load (ortamin tamami, tek toplu hata)
//	defaults.go - varsayilanlar ve sabit adlar (port haritasi, NODE_ENV, servisler)
//	env.go      - genel okuyucular: metin, tam sayi, bool, sure, secenek
//	policy.go   - kendi kurali olan okuyucular: gorsel kok adresi, log seviyesi,
//	              Mongo adresi, JWT sirri (T8.1), Redis adresi (T8.2)
//	seed.go     - persona seed komutunun dar yapilandirmasi (T8.1)
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"time"
)

// ServiceTarget, gateway'in konustugu tek bir gRPC servisi.
type ServiceTarget struct {
	// Kisa ad: gunlukte ve /healthz cevabinda gorunur ("catalog").
	Name string
	// host:port. NEDEN PORT DEGIL ADRES: gateway konteynerde calisirken servis
	// baska bir makinede ya da baska bir konteyner adinda olabilir; yalnizca port
	// tutmak "localhost" varsayimini koda gomerdi.
	Address string
}

// Config, dogrulanmis gateway yapilandirmasi.
type Config struct {
	Port            int
	NodeEnv         string
	LogLevel        slog.Level
	Mock            bool
	ShutdownTimeout time.Duration
	// Tek bir bagimli servise yapilan cagrinin ust siniri (/healthz dahil).
	RequestTimeout time.Duration
	// StockTimeout, urun listesindeki stok sorgusunun ust siniri (T8.4). Asilirsa
	// liste stoksuz doner; RequestTimeout'tan kisadir.
	StockTimeout time.Duration
	Services     []ServiceTarget
	// AssetBaseURL, gorsellerin mutlak adresinin koku. Veri gorseli GORELI yol
	// olarak saklar ("/img/cat/sut.png"); gateway (BFF) istemciye giden cevapta
	// bu koku ekler. Sonunda "/" yoktur.
	AssetBaseURL *url.URL
	// MongoURI, gateway'in koleksiyonlari (users, sessions; T8.1) icin. MOCK'ta
	// bos olabilir: kimlik kayitlari bellekte tutulur.
	MongoURI                    string
	MongoDB                     string
	MongoServerSelectionTimeout time.Duration
	// JWTSecret, erisim jetonunun imza sirri (HS256). Tipi Secret: yanlislikla
	// gunluge ya da hataya yazilsa bile "[gizli]" gorunur.
	JWTSecret Secret
	// JWTTTL, erisim jetonu omru; RefreshTTL, yenileme jetonu omru.
	JWTTTL     time.Duration
	RefreshTTL time.Duration
	// RedisURL, tekrar korumasi (T8.2) icin; MOCK'ta bos olabilir: kayitlar
	// bellekte tutulur. Adres parola tasiyabilir; gunluge yazilmaz.
	RedisURL            string
	RedisConnectTimeout time.Duration
	// IdempotencyTTL, bitmis idempotency kaydinin omru (ADR-08).
	IdempotencyTTL time.Duration
	// RateLimitEnabled false ise hiz siniri yoktur (yuk testleri; T8.2, P2).
	RateLimitEnabled bool
	// RateLimitWindow, kayan pencerenin uzunlugu.
	RateLimitWindow time.Duration
	// Pencere basina izin verilen istek: genel, kimlik uclari, siparis uclari.
	RateLimitGeneral int
	RateLimitAuth    int
	RateLimitOrder   int
}

// Secret, gunluge ya da hata metnine yazilmamasi gereken deger. fmt (%v, %s,
// %x) ve slog onu "[gizli]" olarak basar; bayt icerigine yalnizca Bytes ile ulasilir.
type Secret []byte

// String, degeri gizler.
func (Secret) String() string { return redacted }

// LogValue, slog icin degeri gizler.
func (Secret) LogValue() slog.Value { return slog.StringValue(redacted) }

// Bytes, imza icin ham deger.
func (s Secret) Bytes() []byte { return []byte(s) }

const redacted = "[gizli]"

// Addr, Fiber'in dinleyecegi adresi verir.
func (c Config) Addr() string {
	return fmt.Sprintf(":%d", c.Port)
}

// Getenv, ortam okuyucusudur. Testte sahte bir fonksiyon verilir; boylece
// testler gercek ortami kirletmez ve paralel kosabilir.
type Getenv func(string) string

// Load, ortami okur ve dogrular. Birden fazla sorun varsa hepsi tek hatada birlesir.
func Load(getenv Getenv) (Config, error) {
	var problems []error

	port, err := readInt(getenv, "GATEWAY_PORT", defaultPort, minPort, maxPort)
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

	// Servis listesi sabittir: gateway'in dogrudan konustugu uc servis (stok
	// T8.4'ten beri). Yeni servis geldiginde buraya bir satir eklenir; adres yine
	// ortamdan gelir. /healthz listedeki her servisi yoklar.
	services := []ServiceTarget{
		{Name: CatalogService, Address: readString(getenv, "CATALOG_GRPC_ADDR", defaultCatalogAddress)},
		{Name: InventoryService, Address: readString(getenv, "INVENTORY_GRPC_ADDR", defaultInventoryAddress)},
		{Name: OrderService, Address: readString(getenv, "ORDER_GRPC_ADDR", defaultOrderAddress)},
	}

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
		MongoURI:                    mongoURI,
		MongoDB:                     readString(getenv, "MONGO_DB", defaultMongoDB),
		MongoServerSelectionTimeout: mongoTimeout,
		JWTSecret:                   jwtSecret,
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
	}, nil
}
