package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/health"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/httpapi"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/redisdb"
)

// redisHealthName, /healthz raporunda Redis'in adi.
const redisHealthName = "redis"

// fingerprintKeyLabel, istek parmak izi anahtarinin JWT sirrindan turetilme
// etiketi. Ayri etiket ayni sirri iki ise baglamaz: parmak izi anahtari jeton
// imzalayamaz, imza anahtari parmak izi uretemez.
const fingerprintKeyLabel = "getir-gateway/idempotency-fingerprint/v1"

// idempotencyParts, tekrar korumasi icin kurulan parcalar (T8.2).
type idempotencyParts struct {
	settings httpapi.Idempotency
	// pingers, /healthz'ye eklenen bagimliliklar; MOCK'ta bos.
	pingers map[string]health.Pinger
	// close, Redis baglantisini birakir; MOCK'ta bir sey yapmaz.
	close func() error
}

// buildIdempotency, tekrar korumasinin deposunu kurar.
//
// Depo MOCK ile secilir (Node servisleriyle ayni kural): MOCK=true ise kayitlar
// BELLEKTE tutulur ve Redis'e HIC dokunulmaz; aksi halde Redis'e baglanilir.
// Tek gateway orneginde ikisi ayni davranir; birden fazla ornek ancak Redis'i
// paylasirsa tekrari birbirinden gorur.
func buildIdempotency(ctx context.Context, cfg config.Config) (idempotencyParts, error) {
	parts := idempotencyParts{
		settings: httpapi.Idempotency{
			FingerprintKey: fingerprintKey(cfg.JWTSecret.Bytes()),
			TTL:            cfg.IdempotencyTTL,
		},
		close: func() error { return nil },
	}
	if cfg.Mock {
		parts.settings.Store = idempotency.NewMemory(time.Now)
		return parts, nil
	}

	client, err := redisdb.Connect(ctx, redisdb.Options{
		URL:              cfg.RedisURL,
		ConnectTimeout:   cfg.RedisConnectTimeout,
		OperationTimeout: cfg.RequestTimeout,
	})
	if err != nil {
		return idempotencyParts{}, err
	}
	parts.settings.Store = idempotency.NewRedis(client)
	parts.pingers = map[string]health.Pinger{redisHealthName: redisdb.NewPinger(client)}
	parts.close = client.Close
	return parts, nil
}

// fingerprintKey, JWT sirrindan parmak izi anahtarini turetir (HMAC).
func fingerprintKey(secret []byte) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(fingerprintKeyLabel))
	return mac.Sum(nil)
}
