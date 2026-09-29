package main

import (
	"testing"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ratelimit"
)

func TestBuildRateLimitChoosesCounter(t *testing.T) {
	cfg := redisConfig(false, "redis://127.0.0.1:1")
	cfg.RateLimitEnabled = true
	cfg.RateLimitWindow = time.Minute
	cfg.RateLimitGeneral, cfg.RateLimitAuth, cfg.RateLimitOrder = 120, 10, 20

	if limits := buildRateLimit(cfg, lazyClient(t)); limits.Window != time.Minute ||
		limits.General != 120 || limits.Auth != 10 || limits.Order != 20 {
		t.Errorf("sinirlar ayardan gelmeli: %+v", limits)
	} else if _, ok := limits.Limiter.(*ratelimit.Redis); !ok {
		t.Errorf("istemci varken Redis sayaci bekleniyordu: %T", limits.Limiter)
	}
	if _, ok := buildRateLimit(cfg, nil).Limiter.(*ratelimit.Memory); !ok {
		t.Error("istemci yokken (MOCK) bellek sayaci bekleniyordu")
	}

	cfg.RateLimitEnabled = false
	if limits := buildRateLimit(cfg, lazyClient(t)); limits.Limiter != nil {
		t.Errorf("RATE_LIMIT_ENABLED=false iken sayac olmamali: %T", limits.Limiter)
	}
}
