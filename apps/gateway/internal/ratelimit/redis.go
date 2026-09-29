package ratelimit

import (
	"context"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// slidingWindowScript, KEYS[1] sayacinda ARGV[1] ms'lik pencerede en fazla
// ARGV[2] istek kabul eder. Tek betik: pencereden cikanlari atmak, saymak ve
// yazmak arasina baska istemci giremez (ADR-01 ile ayni desen).
//
// SAAT REDIS'IN (TIME): butun gateway ornekleri ayni saate bakar; ornekler
// arasindaki saat farki pencere sinirinda sayimi kaydiramaz. Redis 7 betigi
// etkileriyle cogalttigi icin TIME'dan sonra yazmak serbesttir.
//
// Donus: {1, 0} kabul; {0, bekleme_ms} ret. Reddedilen istek YAZILMAZ.
// Uye adi "an-ek": ayni milisaniyedeki iki istek birbirinin ustune yazmasin.
const slidingWindowScript = `
local now = redis.call('TIME')
local nowMs = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', nowMs - window)
if redis.call('ZCARD', KEYS[1]) < limit then
  redis.call('ZADD', KEYS[1], nowMs, nowMs .. '-' .. ARGV[3])
  redis.call('PEXPIRE', KEYS[1], window)
  return {1, 0}
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local wait = tonumber(oldest[2]) + window - nowMs
if wait < 1 then
  wait = 1
end
return {0, wait}
`

var slidingWindow = redis.NewScript(slidingWindowScript)

// Redis, Redis sayaci. Anahtarin omru pencere kadardir (PEXPIRE): son kabul
// edilen istekten bir pencere sonra anahtar kendiliginden duser.
type Redis struct {
	client *redis.Client
}

// NewRedis, istemciyle kurar.
func NewRedis(client *redis.Client) *Redis {
	return &Redis{client: client}
}

// Allow, betigi calistirir.
func (r *Redis) Allow(ctx context.Context, key string, limit int, window time.Duration) (Decision, error) {
	member := hex.EncodeToString(ids.RandomBytes(6))
	result, err := slidingWindow.Run(ctx, r.client, []string{key}, window.Milliseconds(), limit, member).Int64Slice()
	if err != nil {
		return Decision{}, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	if len(result) != 2 {
		return Decision{}, fmt.Errorf("%w: beklenmeyen betik cevabi %v", ErrUnavailable, result)
	}
	if result[0] == 1 {
		return Decision{Allowed: true}, nil
	}
	return Decision{RetryAfter: time.Duration(result[1]) * time.Millisecond}, nil
}
