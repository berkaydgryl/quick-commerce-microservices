package main

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
)

func idempotencyConfig(mock bool, redisURL string) config.Config {
	cfg := authConfig(mock, "")
	cfg.RedisURL = redisURL
	cfg.RedisConnectTimeout = 300 * time.Millisecond
	cfg.IdempotencyTTL = 24 * time.Hour
	return cfg
}

func TestBuildIdempotencyInMockModeUsesMemoryAndSkipsRedis(t *testing.T) {
	// MOCK'ta Redis adresi verilmis olsa bile ona HIC gidilmez; /healthz'de de
	// redis gorunmez.
	parts, err := buildIdempotency(t.Context(), idempotencyConfig(true, "redis://127.0.0.1:1"))
	if err != nil {
		t.Fatalf("MOCK'ta kurulum Redis'siz basarmali: %v", err)
	}
	if _, memory := parts.settings.Store.(*idempotency.Memory); !memory {
		t.Errorf("MOCK'ta bellek deposu bekleniyordu: %T", parts.settings.Store)
	}
	if len(parts.pingers) != 0 {
		t.Errorf("MOCK'ta saglik raporuna Redis eklenmemeli: %v", parts.pingers)
	}
	if parts.settings.TTL != 24*time.Hour || len(parts.settings.FingerprintKey) == 0 {
		t.Errorf("omur ve parmak izi anahtari ayardan gelmeli: %+v", parts.settings)
	}
	if err := parts.close(); err != nil {
		t.Errorf("MOCK'ta kapatma bir sey yapmamali: %v", err)
	}
}

func TestBuildIdempotencyFailsFastWhenRedisIsUnreachable(t *testing.T) {
	startedAt := time.Now()

	_, err := buildIdempotency(t.Context(), idempotencyConfig(false, "redis://127.0.0.1:1"))

	if err == nil || !strings.Contains(err.Error(), "redis'e ulasilamadi") {
		t.Fatalf("ulasilamayan Redis acilis hatasi vermeli: %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 3*time.Second {
		t.Errorf("baglanti suresi uygulanmali, %v surdu", elapsed)
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
