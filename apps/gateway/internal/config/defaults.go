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

// NODE_ENV degerleri (Node servisleriyle ayni sozluk). Production, gelistirme
// kolayliklarinin (X-User-Id kimligi, T7.5) KAPALI oldugu tek ortamdir.
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
