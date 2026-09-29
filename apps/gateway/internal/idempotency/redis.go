package idempotency

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// ownedScript, KEYS[1] hala ARGV[1] jetonuyla "isleniyor" ise ARGV[2] islemini
// yapar: "complete" -> ARGV[3] degerini ARGV[4] ms omurle yazar, "release" ->
// siler. Tek script: okuma ve yazma arasina baska istemci giremez.
const ownedScript = `
local current = redis.call('GET', KEYS[1])
if not current then
  return 0
end
local record = cjson.decode(current)
if record.state ~= 'in-progress' or record.token ~= ARGV[1] then
  return 0
end
if ARGV[2] == 'complete' then
  redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[4])
else
  redis.call('DEL', KEYS[1])
end
return 1
`

var owned = redis.NewScript(ownedScript)

// Redis, Redis deposu. Kayit JSON olarak tek anahtarda durur; omur Redis'in
// kendi suresidir (PX), supurucu gerekmez.
type Redis struct {
	client *redis.Client
}

// NewRedis, istemciyle kurar.
func NewRedis(client *redis.Client) *Redis {
	return &Redis{client: client}
}

// Claim, SET NX PX ile alir; anahtar doluysa mevcut kaydi okur.
func (r *Redis) Claim(ctx context.Context, key string, claim Record, ttl time.Duration) (bool, Record, error) {
	value, err := json.Marshal(claim)
	if err != nil {
		return false, Record{}, fmt.Errorf("kayit kodlanamadi: %w", err)
	}
	// Anahtar SET ile GET arasinda suresi dolup silinebilir: o durumda bir kez
	// daha almayi dener (ikinci turda da bos gorunurse alir).
	for attempt := 0; attempt < 2; attempt++ {
		err := r.client.SetArgs(ctx, key, value, redis.SetArgs{Mode: "NX", TTL: ttl}).Err()
		switch {
		case err == nil:
			return true, Record{}, nil
		case !errors.Is(err, redis.Nil):
			return false, Record{}, fmt.Errorf("%w: %w", ErrUnavailable, err)
		}
		raw, err := r.client.Get(ctx, key).Bytes()
		if errors.Is(err, redis.Nil) {
			continue
		}
		if err != nil {
			return false, Record{}, fmt.Errorf("%w: %w", ErrUnavailable, err)
		}
		var existing Record
		if err := json.Unmarshal(raw, &existing); err != nil {
			return false, Record{}, fmt.Errorf("kayit cozulemedi: %w", err)
		}
		if existing.State == StateInProgress && existing.Token == claim.Token {
			// Kayit BU istegin jetonunu tasiyor: onceki SET NX yazilmis, cevabi
			// kaybolmustu (jeton istek basina rastgele; baskasi yazamaz).
			return true, Record{}, nil
		}
		return false, existing, nil
	}
	return false, Record{}, fmt.Errorf("%w: anahtar alinamadi", ErrUnavailable)
}

// Complete, script ile bitirir.
func (r *Redis) Complete(ctx context.Context, key, token string, done Record, ttl time.Duration) (bool, error) {
	value, err := json.Marshal(done)
	if err != nil {
		return false, fmt.Errorf("kayit kodlanamadi: %w", err)
	}
	return r.runOwned(ctx, key, token, "complete", string(value), ttl.Milliseconds())
}

// Release, script ile siler.
func (r *Redis) Release(ctx context.Context, key, token string) (bool, error) {
	return r.runOwned(ctx, key, token, "release", "", 0)
}

func (r *Redis) runOwned(ctx context.Context, key, token, action, value string, ttlMs int64) (bool, error) {
	result, err := owned.Run(ctx, r.client, []string{key}, token, action, value, ttlMs).Int()
	if err != nil {
		return false, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	return result == 1, nil
}
