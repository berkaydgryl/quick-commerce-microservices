package main

import (
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/httpapi"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
)

// fingerprintKeyLabel, istek parmak izi anahtarinin JWT sirrindan turetilme
// etiketi. Ayri etiket ayni sirri iki ise baglamaz: parmak izi anahtari jeton
// imzalayamaz, imza anahtari parmak izi uretemez.
const fingerprintKeyLabel = "getir-gateway/idempotency-fingerprint/v1"

// buildIdempotency, tekrar korumasini kurar (T8.2). Redis istemcisi yoksa
// (MOCK) kayitlar BELLEKTE tutulur: tek gateway orneginde ayni davranir,
// ornekler arasinda paylasilmaz.
func buildIdempotency(cfg config.Config, client *redis.Client) httpapi.Idempotency {
	settings := httpapi.Idempotency{
		FingerprintKey: fingerprintKey(cfg.JWTSecret.Bytes()),
		TTL:            cfg.IdempotencyTTL,
	}
	if client == nil {
		settings.Store = idempotency.NewMemory(time.Now)
		return settings
	}
	settings.Store = idempotency.NewRedis(client)
	return settings
}

// fingerprintKey, JWT sirrindan parmak izi anahtarini turetir (HMAC).
func fingerprintKey(secret []byte) []byte {
	return derivedKey(secret, fingerprintKeyLabel)
}
