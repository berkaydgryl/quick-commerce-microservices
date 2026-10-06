package ratelimit

import (
	"context"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// FailureCounter, yalnizca BASARISIZ denemeleri sayan kayan pencere (T11.17,
// QA S1): kart ekleme saglayici reddini ve gecersiz karti sayar, basariyi
// saymaz. Limiter'dan farki: bakmak (Peek) sayaci DEGISTIRMEZ; sayac yalnizca
// sonuc bilinince (Record) yazilir.
type FailureCounter interface {
	// Peek, penceredeki kayit sayisi limit'e ulastiysa reddeder; YAZMAZ.
	Peek(ctx context.Context, key string, limit int, window time.Duration) (Decision, error)
	// Record, bir basarisizligi pencereye yazar; anahtarin omru pencere kadardir.
	Record(ctx context.Context, key string, window time.Duration) error
}

// Peek, sayaci degistirmeden bakar.
func (m *Memory) Peek(_ context.Context, key string, limit int, window time.Duration) (Decision, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	counter, found := m.counters[key]
	if !found {
		return Decision{Allowed: true}, nil
	}
	counter.hits = live(counter.hits, now, window)
	return failureDecision(counter.hits, limit, now, window), nil
}

// Record, basarisizligi pencereye yazar.
func (m *Memory) Record(_ context.Context, key string, window time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	counter, found := m.counters[key]
	if !found {
		counter = &memoryCounter{}
		m.counters[key] = counter
	}
	counter.window = window
	counter.hits = append(live(counter.hits, now, window), now)
	return nil
}

// failureDecision, limit kadar kayit varsa ret: sayi limitin altina, en eski
// (sayi - limit + 1) kayit dusunce iner. Es zamanli Record'lar sayiyi limitin
// ustune cikarabilir; bekleme yine dogru kayittan hesaplanir.
func failureDecision(hits []time.Time, limit int, now time.Time, window time.Duration) Decision {
	if len(hits) < limit {
		return Decision{Allowed: true}
	}
	return Decision{RetryAfter: retryAfter(hits[len(hits)-limit], now, window)}
}

// peekScript, KEYS[1]'de ARGV[1] ms'lik pencerede ARGV[2] kayit varsa reddeder;
// YAZMAZ (pencereden cikanlar atilir). Donus: {1, 0} kabul; {0, bekleme_ms} ret.
const peekScript = `
local now = redis.call('TIME')
local nowMs = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', nowMs - window)
local count = redis.call('ZCARD', KEYS[1])
if count < limit then
  return {1, 0}
end
local oldest = redis.call('ZRANGE', KEYS[1], count - limit, count - limit, 'WITHSCORES')
local wait = tonumber(oldest[2]) + window - nowMs
if wait < 1 then
  wait = 1
end
return {0, wait}
`

// recordScript, KEYS[1]'e bir kayit yazar; anahtarin omru pencere kadardir.
const recordScript = `
local now = redis.call('TIME')
local nowMs = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local window = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', nowMs - window)
redis.call('ZADD', KEYS[1], nowMs, nowMs .. '-' .. ARGV[2])
redis.call('PEXPIRE', KEYS[1], window)
return 1
`

var (
	peekFailures   = redis.NewScript(peekScript)
	recordFailures = redis.NewScript(recordScript)
)

// Peek, betigi calistirir.
func (r *Redis) Peek(ctx context.Context, key string, limit int, window time.Duration) (Decision, error) {
	result, err := peekFailures.Run(ctx, r.client, []string{key}, window.Milliseconds(), limit).Int64Slice()
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

// Record, betigi calistirir.
func (r *Redis) Record(ctx context.Context, key string, window time.Duration) error {
	member := hex.EncodeToString(ids.RandomBytes(6))
	if err := recordFailures.Run(ctx, r.client, []string{key}, window.Milliseconds(), member).Err(); err != nil {
		return fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	return nil
}
