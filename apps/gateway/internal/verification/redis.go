package verification

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Channel, dogrulamanin kanali: anahtarin ikinci parcasi.
type Channel string

// Kanallar (T11.14: e-posta PR 1, telefon PR 3).
const (
	ChannelEmail Channel = "email"
	ChannelPhone Channel = "phone"
)

// Key, kullanicinin o kanaldaki bekleyen dogrulamasinin anahtari:
// verify:email:{usr_...}, verify:phone:{usr_...}. Bicim @getir/redis-kit
// keys.ts'te tanimlidir (emailVerificationKey, phoneVerificationKey); yazan tek
// taraf gateway'dir, contract_test.go iki tarafi karsilastirir. Kanallar ayri
// anahtardir: e-posta kodu telefon kodunun beklemesini ya da hakkini yemez.
func Key(channel Channel, userID string) string {
	return "verify:" + string(channel) + ":{" + userID + "}"
}

// Alanlar: address (e-posta ya da numara), codeHash (kilitlenince silinir),
// attempts, sentAt (ms).
//
// SAAT REDIS'IN (TIME): butun gateway ornekleri ayni saate bakar (hiz
// siniriyla ayni gerekce); Redis 7 betigi etkileriyle cogaltir.

// startScript: ARGV[1] adres, ARGV[2] ozet, ARGV[3] omur ms, ARGV[4] bekleme ms.
// Donus: 0 yazildi; > 0 kalan bekleme (ms), yazilmadi.
const startScript = `
local now = redis.call('TIME')
local nowMs = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local sentAt = redis.call('HGET', KEYS[1], 'sentAt')
if sentAt then
  local wait = tonumber(sentAt) + tonumber(ARGV[4]) - nowMs
  if wait > 0 then
    return wait
  end
end
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'address', ARGV[1], 'codeHash', ARGV[2], 'attempts', 0, 'sentAt', nowMs)
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 0
`

// checkScript: ARGV[1] adres, ARGV[2] ozet, ARGV[3] en fazla deneme.
// Donus: {sonuc, kalan hak}; sonuc Result'in sayisidir (1 dogru, 2 yanlis,
// 3 kilitli, 4 yok). HINCRBY ve HDEL anahtarin omrune dokunmaz.
const checkScript = `
local fields = redis.call('HMGET', KEYS[1], 'address', 'codeHash')
if not fields[1] or fields[1] ~= ARGV[1] then
  return {4, 0}
end
if not fields[2] then
  return {3, 0}
end
if fields[2] == ARGV[2] then
  redis.call('DEL', KEYS[1])
  return {1, 0}
end
local left = tonumber(ARGV[3]) - redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if left <= 0 then
  redis.call('HDEL', KEYS[1], 'codeHash')
  return {3, 0}
end
return {2, left}
`

// discardScript: ARGV[1] ozet. Kayit yalnizca ozet ayniysa silinir.
const discardScript = `
if redis.call('HGET', KEYS[1], 'codeHash') == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

var (
	start   = redis.NewScript(startScript)
	check   = redis.NewScript(checkScript)
	discard = redis.NewScript(discardScript)
)

// ErrUnavailable, Redis'e ulasilamadi ya da beklenmeyen cevap verdi.
var ErrUnavailable = errors.New("dogrulama deposu kullanilamiyor")

// Redis, bir kanalin Redis deposu.
type Redis struct {
	client  *redis.Client
	channel Channel
}

// NewRedis, istemci ve kanalla kurar.
func NewRedis(client *redis.Client, channel Channel) *Redis {
	return &Redis{client: client, channel: channel}
}

// Start, startScript'i calistirir.
func (r *Redis) Start(ctx context.Context, userID string, pending Pending, ttl, resendAfter time.Duration) (time.Duration, error) {
	wait, err := start.Run(ctx, r.client, []string{Key(r.channel, userID)},
		pending.Address, pending.CodeHash, ttl.Milliseconds(), resendAfter.Milliseconds()).Int64()
	if err != nil {
		return 0, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	return time.Duration(wait) * time.Millisecond, nil
}

// Check, checkScript'i calistirir.
func (r *Redis) Check(ctx context.Context, userID string, pending Pending, maxAttempts int) (Outcome, error) {
	result, err := check.Run(ctx, r.client, []string{Key(r.channel, userID)}, pending.Address, pending.CodeHash, maxAttempts).Int64Slice()
	if err != nil {
		return Outcome{}, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	if len(result) != 2 || result[0] < int64(ResultVerified) || result[0] > int64(ResultExpired) {
		return Outcome{}, fmt.Errorf("%w: beklenmeyen betik cevabi %v", ErrUnavailable, result)
	}
	return Outcome{Result: Result(result[0]), AttemptsLeft: int(result[1])}, nil
}

// Discard, discardScript'i calistirir.
func (r *Redis) Discard(ctx context.Context, userID, codeHash string) error {
	if err := discard.Run(ctx, r.client, []string{Key(r.channel, userID)}, codeHash).Err(); err != nil {
		return fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	return nil
}

// PendingAddress, kaydin address alani (HGET; omru TTL'dir, anahtar yoksa "").
func (r *Redis) PendingAddress(ctx context.Context, userID string) (string, error) {
	address, err := r.client.HGet(ctx, Key(r.channel, userID), "address").Result()
	if errors.Is(err, redis.Nil) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	return address, nil
}
