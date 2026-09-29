package main

import (
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/httpapi"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ratelimit"
)

// buildRateLimit, hiz sinirini kurar (T8.2, roadmap P2).
//
//	RATE_LIMIT_ENABLED=false -> sayac yok, sinir kapali (yuk testleri)
//	MOCK (istemci yok)       -> sayac bellekte: yalnizca tek ornekli gelistirme
//	aksi halde               -> sayac Redis'te: ornekler arasi ortak sinir
func buildRateLimit(cfg config.Config, client *redis.Client) httpapi.RateLimit {
	settings := httpapi.RateLimit{
		Window:  cfg.RateLimitWindow,
		General: cfg.RateLimitGeneral,
		Auth:    cfg.RateLimitAuth,
		Order:   cfg.RateLimitOrder,
	}
	switch {
	case !cfg.RateLimitEnabled:
	case client == nil:
		settings.Limiter = ratelimit.NewMemory(time.Now)
	default:
		settings.Limiter = ratelimit.NewRedis(client)
	}
	return settings
}
