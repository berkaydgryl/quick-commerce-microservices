package main

import (
	"fmt"

	cardvaultv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/cardvault/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/cards"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/clients"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/httpapi"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ratelimit"
)

// buildCardRoutes, kart kasasi uclarinin bagimliliklari (T11.17). Production'da
// bos doner: uclar baglanmaz, payment havuzda da yoktur (K1, config/cards.go).
// Basarisiz dogrulama sayaci hiz siniriyla ayni depodadir (Redis ya da MOCK'ta
// bellek); hiz siniri kapaliysa kullanici siniri da kapalidir.
func buildCardRoutes(cfg config.Config, pool *clients.Pool, rateLimit httpapi.RateLimit) (httpapi.CardRoutes, error) {
	if !cfg.CardVaultEnabled() {
		return httpapi.CardRoutes{}, nil
	}
	conn, ok := pool.Conn(config.PaymentService)
	if !ok {
		return httpapi.CardRoutes{}, fmt.Errorf("%s baglantisi havuzda yok", config.PaymentService)
	}
	vault := cards.New(cardvaultv1.NewCardVaultServiceClient(conn), cfg.RequestTimeout)
	routes := httpapi.CardRoutes{Lister: vault, Adder: vault, Deleter: vault, Renamer: vault}
	if failures, counts := rateLimit.Limiter.(ratelimit.FailureCounter); counts {
		routes.Failures = failures
	}
	if inflight, locks := rateLimit.Limiter.(ratelimit.InflightLock); locks {
		routes.Inflight = inflight
	}
	return routes, nil
}
