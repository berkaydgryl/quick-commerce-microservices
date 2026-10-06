package ratelimit

import (
	"context"
	"testing"
	"time"
)

// Basarisizlik sayacinin sozlesmesi (T11.17, K2): bellek ve Redis ayni
// testlerden gecer (Redis'teki karsiligi redis_integration_test.go).
func failureCounterContract(t *testing.T, newCounter func() FailureCounter, window time.Duration, advance func(time.Duration)) {
	ctx := context.Background()
	peek := func(t *testing.T, counter FailureCounter, key string, limit int) Decision {
		t.Helper()
		decision, err := counter.Peek(ctx, key, limit, window)
		if err != nil {
			t.Fatalf("sayac hatasi: %v", err)
		}
		return decision
	}
	record := func(t *testing.T, counter FailureCounter, key string) {
		t.Helper()
		if err := counter.Record(ctx, key, window); err != nil {
			t.Fatalf("sayac hatasi: %v", err)
		}
	}

	t.Run("bakmak sayaci degistirmez; yalnizca kayit sayilir", func(t *testing.T) {
		counter := newCounter()
		key := Key("usr_0123456789abcdef0123456789abcdef", "POST_/v1/me/cards/fail-1h")
		for range 10 {
			if decision := peek(t, counter, key, 2); !decision.Allowed {
				t.Fatal("kayit yokken bakmak reddetmemeli")
			}
		}
		record(t, counter, key)
		if decision := peek(t, counter, key, 2); !decision.Allowed {
			t.Fatal("bir kayit, sinir 2: kabul")
		}
		record(t, counter, key)
		decision := peek(t, counter, key, 2)
		if decision.Allowed || decision.RetryAfter <= 0 || decision.RetryAfter > window {
			t.Errorf("iki kayit, sinir 2: ret ve bekleme (0, pencere] olmali: %+v", decision)
		}
	})

	t.Run("kayitlar pencereden dusunce yeniden kabul", func(t *testing.T) {
		counter := newCounter()
		key := Key("usr_1123456789abcdef0123456789abcdef", "POST_/v1/me/cards/fail-1h")
		record(t, counter, key)
		advance(window / 2)
		record(t, counter, key)
		if decision := peek(t, counter, key, 2); decision.Allowed {
			t.Fatal("sinir dolu olmali")
		}
		advance(window/2 + window/5)

		if decision := peek(t, counter, key, 2); !decision.Allowed {
			t.Errorf("ilk kayit dustu, kabul olmali: %+v", decision)
		}
	})

	t.Run("sinirin ustunde kayit varsa bekleme sayiyi sinirin altina indiren kayda gore", func(t *testing.T) {
		counter := newCounter()
		key := Key("usr_2123456789abcdef0123456789abcdef", "POST_/v1/me/cards/fail-1h")
		record(t, counter, key)
		advance(window / 4)
		record(t, counter, key)
		record(t, counter, key)

		// Sinir 2, kayit 3: en eski ikisi degil, en eskisi dusunce sayi 2 kalir ve
		// hala ret; ikinci (window/4'teki) dusunce 1'e iner. Bekleme ~ tam pencere.
		decision := peek(t, counter, key, 2)
		if decision.Allowed || decision.RetryAfter < window-window/4 {
			t.Errorf("bekleme ikinci kayda gore (~pencere) olmali: %+v", decision)
		}
	})

	t.Run("sayaclar ozne ve pencere basina bagimsiz", func(t *testing.T) {
		counter := newCounter()
		user := "usr_3123456789abcdef0123456789abcdef"
		record(t, counter, Key(user, "POST_/v1/me/cards/fail-1h"))
		for _, key := range []string{Key("usr_4123456789abcdef0123456789abcdef", "POST_/v1/me/cards/fail-1h"), Key(user, "POST_/v1/me/cards/fail-1d")} {
			if decision := peek(t, counter, key, 1); !decision.Allowed {
				t.Errorf("%s kendi sayacina sahip olmali", key)
			}
		}
	})
}

func TestMemoryFailureCounterContract(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)}
	failureCounterContract(t, func() FailureCounter { return NewMemory(clock.Now) }, time.Hour, func(d time.Duration) {
		clock.now = clock.now.Add(d)
	})
}
