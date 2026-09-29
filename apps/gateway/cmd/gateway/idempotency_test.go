package main

import (
	"bytes"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
)

// lazyClient, baglanmayan istemci: go-redis baglantiyi ilk komutta kurar.
// Kurucularin hangi depoyu sectigini sinamak icin Redis gerekmez.
func lazyClient(t *testing.T) *redis.Client {
	t.Helper()
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	t.Cleanup(func() {
		if err := client.Close(); err != nil {
			t.Errorf("istemci kapatilamadi: %v", err)
		}
	})
	return client
}

func TestBuildIdempotencyChoosesStoreByClient(t *testing.T) {
	cfg := redisConfig(true, "")
	cfg.IdempotencyTTL = 24 * time.Hour

	memory := buildIdempotency(cfg, nil)
	if _, ok := memory.Store.(*idempotency.Memory); !ok {
		t.Errorf("istemci yokken (MOCK) bellek deposu bekleniyordu: %T", memory.Store)
	}
	if memory.TTL != 24*time.Hour || len(memory.FingerprintKey) == 0 {
		t.Errorf("omur ve parmak izi anahtari ayardan gelmeli: %+v", memory)
	}
	if shared := buildIdempotency(cfg, lazyClient(t)); shared.Store == nil {
		t.Error("istemci varken Redis deposu kurulmali")
	} else if _, ok := shared.Store.(*idempotency.Redis); !ok {
		t.Errorf("Redis deposu bekleniyordu: %T", shared.Store)
	}
}

func TestFingerprintKeyIsDerivedNotTheSecret(t *testing.T) {
	// Parmak izi anahtari JWT sirrinin KENDISI olmamali: ayri etiketle
	// turetilir; ayni sirdan her acilista ayni anahtar cikar (kayitlar
	// yeniden baslatmadan sonra da eslesir).
	secret := []byte("yalnizca-test-icin-imza-sirri-32-bayttan-uzun")

	first, second := fingerprintKey(secret), fingerprintKey(secret)

	if !bytes.Equal(first, second) || bytes.Equal(first, secret) || len(first) != 32 {
		t.Errorf("sirdan turetilmis, sabit, 32 baytlik anahtar bekleniyordu: %x", first)
	}
	if bytes.Equal(first, fingerprintKey([]byte("baska-bir-sir-32-bayttan-uzun-olmali-ki"))) {
		t.Error("farkli sir farkli anahtar vermeli")
	}
}
