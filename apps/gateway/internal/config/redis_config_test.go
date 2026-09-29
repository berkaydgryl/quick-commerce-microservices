package config

import (
	"strings"
	"testing"
	"time"
)

func TestRedisAndIdempotencyDefaults(t *testing.T) {
	cfg, err := Load(minimalEnv(nil))
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if cfg.RedisURL != testRedisURL || cfg.RedisConnectTimeout != 5*time.Second || cfg.IdempotencyTTL != 24*time.Hour {
		t.Errorf(".env.example varsayilanlari bekleniyordu: %q %v %v", cfg.RedisURL, cfg.RedisConnectTimeout, cfg.IdempotencyTTL)
	}
}

func TestRedisAndIdempotencyValuesAreRead(t *testing.T) {
	cfg, err := Load(minimalEnv(map[string]string{
		"REDIS_URL": "rediss://:parola@cache.internal:6380/2", "REDIS_CONNECT_TIMEOUT_MS": "1500", "IDEMPOTENCY_TTL_SECONDS": "3600",
	}))
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if cfg.RedisURL != "rediss://:parola@cache.internal:6380/2" || cfg.RedisConnectTimeout != 1500*time.Millisecond || cfg.IdempotencyTTL != time.Hour {
		t.Errorf("degerler okunamadi: %q %v %v", cfg.RedisURL, cfg.RedisConnectTimeout, cfg.IdempotencyTTL)
	}
}

func TestRedisURLIsRequiredOutsideMock(t *testing.T) {
	// Tekrar korumasi olmadan siparis acilmaz: Redis MOCK disinda zorunlu.
	_, err := Load(minimalEnv(map[string]string{"REDIS_URL": ""}))
	if err == nil || !strings.Contains(err.Error(), "REDIS_URL") {
		t.Errorf("REDIS_URL zorunlu olmali: %v", err)
	}

	cfg, err := Load(minimalEnv(map[string]string{"REDIS_URL": "", "MONGO_URI": "", "MOCK": "true"}))
	if err != nil || cfg.RedisURL != "" {
		t.Errorf("MOCK'ta Redis gerekmemeli: %q %v", cfg.RedisURL, err)
	}
}

func TestBadRedisURLDoesNotLeakPassword(t *testing.T) {
	for _, value := range []string{"http://:gizli-parola@localhost:6379", "redis://:gizli-parola@", "gizli-parola"} {
		_, err := Load(minimalEnv(map[string]string{"REDIS_URL": value}))
		if err == nil || !strings.Contains(err.Error(), "REDIS_URL") {
			t.Errorf("%q reddedilmeliydi: %v", value, err)
			continue
		}
		if strings.Contains(err.Error(), "gizli-parola") {
			t.Errorf("hata metni adresi (parolayi) icermemeli: %v", err)
		}
	}
}

func TestInvalidIdempotencyTTLIsRejected(t *testing.T) {
	_, err := Load(minimalEnv(map[string]string{"IDEMPOTENCY_TTL_SECONDS": "gun"}))
	if err == nil || !strings.Contains(err.Error(), "IDEMPOTENCY_TTL_SECONDS") {
		t.Errorf("gecersiz omur reddedilmeli: %v", err)
	}
}
