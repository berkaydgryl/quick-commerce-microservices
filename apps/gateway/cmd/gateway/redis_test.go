package main

import (
	"strings"
	"testing"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
)

func redisConfig(mock bool, redisURL string) config.Config {
	cfg := authConfig(mock, "")
	cfg.RedisURL = redisURL
	cfg.RedisConnectTimeout = 300 * time.Millisecond
	return cfg
}

func TestBuildRedisInMockModeSkipsRedis(t *testing.T) {
	// MOCK'ta Redis adresi verilmis olsa bile ona HIC gidilmez; /healthz'de de
	// redis gorunmez.
	parts, err := buildRedis(t.Context(), redisConfig(true, "redis://127.0.0.1:1"))
	if err != nil {
		t.Fatalf("MOCK'ta kurulum Redis'siz basarmali: %v", err)
	}
	if parts.client != nil || len(parts.pingers) != 0 {
		t.Errorf("MOCK'ta istemci ve saglik kalemi olmamali: %+v", parts)
	}
	if err := parts.close(); err != nil {
		t.Errorf("MOCK'ta kapatma bir sey yapmamali: %v", err)
	}
}

func TestBuildRedisFailsFastWhenRedisIsUnreachable(t *testing.T) {
	startedAt := time.Now()

	_, err := buildRedis(t.Context(), redisConfig(false, "redis://127.0.0.1:1"))

	if err == nil || !strings.Contains(err.Error(), "redis'e ulasilamadi") {
		t.Fatalf("ulasilamayan Redis acilis hatasi vermeli: %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 3*time.Second {
		t.Errorf("baglanti suresi uygulanmali, %v surdu", elapsed)
	}
}
