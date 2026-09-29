package config

import (
	"log/slog"
	"time"
)

// Varsayilanlar. Roadmap'teki port haritasi ile birebir ayni.
const (
	defaultPort            = 8080
	defaultCatalogAddress  = "localhost:50051"
	defaultOrderAddress    = "localhost:50053"
	defaultShutdownTimeout = 10 * time.Second
	defaultRequestTimeout  = 5 * time.Second
	defaultLogLevel        = slog.LevelInfo
)

// Kimlik ve Mongo varsayilanlari (T8.1). Adlar ve degerler .env.example ile ayni.
const (
	defaultMongoDB                     = "getir"
	defaultMongoServerSelectionTimeout = 5 * time.Second
	// JWT_TTL=3600 (ADR-12): erisim jetonu 1 saat.
	defaultJWTTTL = time.Hour
	// REFRESH_TTL=1209600: yenileme jetonu 14 gun.
	defaultRefreshTTL = 14 * 24 * time.Hour
	// minJWTSecretBytes: HS256 icin daha kisa sir kaba kuvvete aciktir.
	minJWTSecretBytes = 32
	// exampleJWTSecret, .env.example'daki ornek sir: production'da REDDEDILIR.
	exampleJWTSecret = "dev-only-insecure-secret-change-me"
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
	CatalogService = "catalog"
	OrderService   = "order"
)

const (
	minPort = 1
	maxPort = 65535
)
