package ratelimit

import (
	"context"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// InflightLock, ozne basina tek isteklik kilit (T11.17, guvenlik incelemesi):
// kart dogrulamasi "bak -> kasaya git -> sonucu yaz" adimlarindan olusur; ayni
// kullanicinin es zamanli istekleri bakma adiminda hep bos sayac gorur ve
// basarisizlik siniri (FailureCounter) asilirdi. Kilit, kullanicinin kart
// dogrulamalarini siraya koyar. Omru vardir: surec cokerse kilit kendiliginden duser.
type InflightLock interface {
	// Acquire, kilit bossa alir ve sahiplik jetonunu doner; doluysa acquired false.
	Acquire(ctx context.Context, key string, ttl time.Duration) (token string, acquired bool, err error)
	// Release, kilidi YALNIZCA jeton tutuyorsa birakir (suresi dolup baskasina gecen kilit silinmez).
	Release(ctx context.Context, key, token string) error
}

// inflightEntry, bellek kilidinin kaydi.
type inflightEntry struct {
	token     string
	expiresAt time.Time
}

// inflight, bellek kilitleri (Memory'nin parcasi; MOCK ve testler).
type inflight struct {
	mu      sync.Mutex
	entries map[string]inflightEntry
}

// Acquire, bellek kilidini alir.
func (m *Memory) Acquire(_ context.Context, key string, ttl time.Duration) (string, bool, error) {
	m.locks.mu.Lock()
	defer m.locks.mu.Unlock()
	now := m.now()
	if m.locks.entries == nil {
		m.locks.entries = map[string]inflightEntry{}
	}
	if entry, held := m.locks.entries[key]; held && now.Before(entry.expiresAt) {
		return "", false, nil
	}
	token := hex.EncodeToString(ids.RandomBytes(8))
	m.locks.entries[key] = inflightEntry{token: token, expiresAt: now.Add(ttl)}
	return token, true, nil
}

// Release, jeton tutuyorsa bellek kilidini birakir.
func (m *Memory) Release(_ context.Context, key, token string) error {
	m.locks.mu.Lock()
	defer m.locks.mu.Unlock()
	if entry, held := m.locks.entries[key]; held && entry.token == token {
		delete(m.locks.entries, key)
	}
	return nil
}

// releaseScript, KEYS[1] ARGV[1] jetonunu tasiyorsa siler (karsilastir ve sil).
const releaseScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

var releaseInflight = redis.NewScript(releaseScript)

// Acquire, SET NX PX ile kilidi alir.
func (r *Redis) Acquire(ctx context.Context, key string, ttl time.Duration) (string, bool, error) {
	token := hex.EncodeToString(ids.RandomBytes(8))
	acquired, err := r.client.SetNX(ctx, key, token, ttl).Result()
	if err != nil {
		return "", false, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	return token, acquired, nil
}

// Release, jeton tutuyorsa kilidi siler.
func (r *Redis) Release(ctx context.Context, key, token string) error {
	if err := releaseInflight.Run(ctx, r.client, []string{key}, token).Err(); err != nil {
		return fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	return nil
}
