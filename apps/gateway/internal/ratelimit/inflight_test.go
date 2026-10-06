package ratelimit

import (
	"context"
	"testing"
	"time"
)

// Tek isteklik kilidin sozlesmesi (T11.17): bellek ve Redis ayni testlerden
// gecer (Redis'teki karsiligi redis_integration_test.go).
func inflightContract(t *testing.T, newLock func() InflightLock, ttl time.Duration, advance func(time.Duration)) {
	ctx := context.Background()
	acquire := func(t *testing.T, lock InflightLock, key string) (string, bool) {
		t.Helper()
		token, acquired, err := lock.Acquire(ctx, key, ttl)
		if err != nil {
			t.Fatalf("kilit hatasi: %v", err)
		}
		return token, acquired
	}

	t.Run("dolu kilit alinamaz; sahibi birakinca alinir", func(t *testing.T) {
		lock := newLock()
		key := Key("usr_0123456789abcdef0123456789abcdef", "POST_/v1/me/cards/inflight")
		token, acquired := acquire(t, lock, key)
		if !acquired {
			t.Fatal("bos kilit alinmali")
		}
		if _, again := acquire(t, lock, key); again {
			t.Fatal("dolu kilit ikinci kez alinmamali")
		}
		if err := lock.Release(ctx, key, token); err != nil {
			t.Fatalf("birakma: %v", err)
		}
		if _, after := acquire(t, lock, key); !after {
			t.Error("birakilan kilit yeniden alinmali")
		}
	})

	t.Run("baska jetonla birakilmaz; omru dolunca kendiliginden duser", func(t *testing.T) {
		lock := newLock()
		key := Key("usr_1123456789abcdef0123456789abcdef", "POST_/v1/me/cards/inflight")
		acquire(t, lock, key)
		if err := lock.Release(ctx, key, "baskasinin-jetonu"); err != nil {
			t.Fatalf("birakma: %v", err)
		}
		if _, acquired := acquire(t, lock, key); acquired {
			t.Fatal("baska jeton kilidi birakmamali")
		}
		advance(ttl + ttl/5)
		if _, acquired := acquire(t, lock, key); !acquired {
			t.Error("omru dolan kilit alinmali")
		}
	})

	t.Run("kilitler ozne basina bagimsiz", func(t *testing.T) {
		lock := newLock()
		acquire(t, lock, Key("usr_2123456789abcdef0123456789abcdef", "POST_/v1/me/cards/inflight"))
		if _, acquired := acquire(t, lock, Key("usr_3123456789abcdef0123456789abcdef", "POST_/v1/me/cards/inflight")); !acquired {
			t.Error("baska kullanicinin kilidi bagimsiz olmali")
		}
	})
}

func TestMemoryInflightContract(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)}
	inflightContract(t, func() InflightLock { return NewMemory(clock.Now) }, 30*time.Second, func(d time.Duration) {
		clock.now = clock.now.Add(d)
	})
}
