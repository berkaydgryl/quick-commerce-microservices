package ratelimit

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// Sayacin sozlesmesi: bellek ve Redis ayni testlerden gecer (Redis'teki
// karsiligi redis_integration_test.go; orada saat gercek, pencere kisa).

type fakeClock struct{ now time.Time }

func (c *fakeClock) Now() time.Time { return c.now }

// limiterContract, bir sayacin uymasi gereken kurallar. advance saati ilerletir
// (bellekte sahte saat, Redis'te gercek bekleme).
func limiterContract(t *testing.T, newLimiter func() Limiter, window time.Duration, advance func(time.Duration)) {
	ctx := context.Background()
	allow := func(t *testing.T, limiter Limiter, key string, limit int) Decision {
		t.Helper()
		decision, err := limiter.Allow(ctx, key, limit, window)
		if err != nil {
			t.Fatalf("sayac hatasi: %v", err)
		}
		return decision
	}

	t.Run("sinira kadar kabul eder, sonra reddeder ve bekleme suresini soyler", func(t *testing.T) {
		limiter := newLimiter()
		key := Key("10.0.0.1", "GET_/v1/sinir")
		for i := range 3 {
			if decision := allow(t, limiter, key, 3); !decision.Allowed {
				t.Fatalf("%d. istek kabul edilmeliydi", i+1)
			}
		}
		decision := allow(t, limiter, key, 3)
		if decision.Allowed || decision.RetryAfter <= 0 || decision.RetryAfter > window {
			t.Errorf("4. istek reddedilmeli, bekleme (0, pencere] olmali: %+v", decision)
		}
	})

	t.Run("pencere kayar: en eski kayit dusunce tek bir yer acilir, sinir aninda patlama olmaz", func(t *testing.T) {
		// Sabit pencerede sayac pencere sinirinda sifirlanir ve iki istek birden
		// gecerdi; kayan pencerede yalnizca dusen kaydin yeri acilir.
		limiter := newLimiter()
		key := Key("10.0.0.2", "GET_/v1/kayan")
		allow(t, limiter, key, 2)
		advance(window / 2)
		allow(t, limiter, key, 2)
		advance(window/2 + window/5)

		if decision := allow(t, limiter, key, 2); !decision.Allowed {
			t.Fatalf("ilk kaydin yeri acilmis olmali: %+v", decision)
		}
		if decision := allow(t, limiter, key, 2); decision.Allowed {
			t.Error("ikinci kayit hala pencerede; yalnizca bir yer acilmali")
		}
	})

	t.Run("reddedilen istek sayilmaz", func(t *testing.T) {
		// Israrla deneyen istemcinin reddedilen istekleri pencereye yazilsaydi
		// hem sayac buyur hem de istemci hic acilmazdi.
		limiter := newLimiter()
		key := Key("10.0.0.3", "GET_/v1/israr")
		allow(t, limiter, key, 1)
		advance(window / 2)
		for range 5 {
			if decision := allow(t, limiter, key, 1); decision.Allowed {
				t.Fatal("sinir doluyken istek reddedilmeli")
			}
		}
		advance(window/2 + window/5)

		if decision := allow(t, limiter, key, 1); !decision.Allowed {
			t.Errorf("tek kabul edilen kayit dustu; istek kabul edilmeli: %+v", decision)
		}
	})

	t.Run("bekleme suresi en eski kaydin dusmesine kalan suredir", func(t *testing.T) {
		limiter := newLimiter()
		key := Key("10.0.0.4", "GET_/v1/bekleme")
		allow(t, limiter, key, 1)
		advance(window / 4)

		// Ust sinir kesin (gecen sure en az window/4); alt pay kisitli CPU'daki
		// gecikmeyi karsilar ama "tam pencere" ya da "sifir" cevabini yakalar.
		decision := allow(t, limiter, key, 1)
		expected := window - window/4
		if decision.Allowed || decision.RetryAfter > expected || decision.RetryAfter < expected-window/4 {
			t.Errorf("bekleme yaklasik %v olmali: %+v", expected, decision)
		}
	})

	t.Run("sayaclar birbirinden bagimsiz: ozne ve rota ayri", func(t *testing.T) {
		limiter := newLimiter()
		user := "usr_0123456789abcdef0123456789abcdef"
		allow(t, limiter, Key(user, "GET_/v1/me"), 1)
		if decision := allow(t, limiter, Key(user, "GET_/v1/me"), 1); decision.Allowed {
			t.Fatal("ayni ozne ve rota sinirda olmali")
		}
		for _, key := range []string{Key("usr_ffffffffffffffffffffffffffffffff", "GET_/v1/me"), Key(user, "GET_/v1/orders/id")} {
			if decision := allow(t, limiter, key, 1); !decision.Allowed {
				t.Errorf("%s kendi sayacina sahip olmali", key)
			}
		}
	})
}

func TestMemoryLimiterContract(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)}
	limiterContract(t, func() Limiter { return NewMemory(clock.Now) }, time.Minute,
		func(d time.Duration) { clock.now = clock.now.Add(d) })
}

func TestMemorySweepsIdleCounters(t *testing.T) {
	// Bir daha gelmeyen istemcilerin sayaclari birikmemeli.
	clock := &fakeClock{now: time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)}
	limiter := NewMemory(clock.Now)
	for i := range sweepEvery - 1 {
		if _, err := limiter.Allow(context.Background(), Key(fmt.Sprintf("10.0.%d.%d", i/250, i%250), "GET_/v1/eski"), 5, time.Second); err != nil {
			t.Fatalf("sayac hatasi: %v", err)
		}
	}
	clock.now = clock.now.Add(2 * time.Second)

	if _, err := limiter.Allow(context.Background(), Key("10.9.9.9", "GET_/v1/yeni"), 5, time.Second); err != nil {
		t.Fatalf("sayac hatasi: %v", err)
	}

	if len(limiter.counters) != 1 {
		t.Errorf("penceresi gecen %d sayac supurulmeli, %d sayac kaldi", sweepEvery-1, len(limiter.counters))
	}
}

func TestKeyFormat(t *testing.T) {
	if got := Key("10.0.0.1", "POST_/v1/orders"); got != "rate:{10.0.0.1}:POST_/v1/orders" {
		t.Errorf("anahtar bicimi: %q", got)
	}
}
