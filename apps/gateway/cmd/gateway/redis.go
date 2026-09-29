package main

import (
	"context"

	"github.com/redis/go-redis/v9"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/config"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/health"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/redisdb"
)

// redisHealthName, /healthz raporunda Redis'in adi.
const redisHealthName = "redis"

// redisParts, gateway'in TEK Redis baglantisi (T8.2): tekrar korumasi ve hiz
// siniri ayni istemciyi paylasir.
type redisParts struct {
	// client nil ise MOCK: Redis'e hic gidilmez, kayitlar ve sayaclar bellekte.
	client *redis.Client
	// pingers, /healthz'ye eklenen bagimliliklar; MOCK'ta bos.
	pingers map[string]health.Pinger
	// close, baglantiyi birakir; MOCK'ta bir sey yapmaz.
	close func() error
}

// buildRedis, Redis'e baglanir (acilista PING: Redis kapaliysa gateway acilmaz).
//
// MOCK ile secilir (Node servisleriyle ayni kural): MOCK=true ise Redis
// adresi verilmis olsa bile ona HIC gidilmez.
func buildRedis(ctx context.Context, cfg config.Config) (redisParts, error) {
	parts := redisParts{close: func() error { return nil }}
	if cfg.Mock {
		return parts, nil
	}
	client, err := redisdb.Connect(ctx, redisdb.Options{
		URL:              cfg.RedisURL,
		ConnectTimeout:   cfg.RedisConnectTimeout,
		OperationTimeout: cfg.RequestTimeout,
	})
	if err != nil {
		return redisParts{}, err
	}
	parts.client = client
	parts.pingers = map[string]health.Pinger{redisHealthName: redisdb.NewPinger(client)}
	parts.close = client.Close
	return parts, nil
}
