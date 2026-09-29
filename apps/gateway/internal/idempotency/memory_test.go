package idempotency

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// Deponun sozlesmesi: bellek ve Redis ayni testlerden gecer (Redis'teki
// karsiligi redis_integration_test.go).

type fakeClock struct{ now time.Time }

func (c *fakeClock) Now() time.Time { return c.now }

func claimOf(token string) Record {
	return Record{State: StateInProgress, Token: token, Fingerprint: "fp"}
}

// storeContract, bir deponun uymasi gereken kurallar.
func storeContract(t *testing.T, newStore func() Store, advance func(time.Duration)) {
	ctx := context.Background()

	t.Run("bos anahtar alinir, dolusu mevcut kaydi doner", func(t *testing.T) {
		store := newStore()
		claimed, _, err := store.Claim(ctx, Key("usr_1", "anahtar-01"), claimOf("a"), time.Minute)
		if err != nil || !claimed {
			t.Fatalf("bos anahtar alinmali: %v %v", claimed, err)
		}
		claimed, existing, err := store.Claim(ctx, Key("usr_1", "anahtar-01"), claimOf("b"), time.Minute)
		if err != nil || claimed || existing.State != StateInProgress || existing.Token != "a" || existing.Fingerprint != "fp" {
			t.Errorf("dolu anahtar alinmamali ve ilk kayit donmeli: %v %+v %v", claimed, existing, err)
		}
	})

	t.Run("yalnizca sahibi bitirir; bitmis kayit govdesiyle doner", func(t *testing.T) {
		store := newStore()
		key := Key("usr_1", "anahtar-02")
		if _, _, err := store.Claim(ctx, key, claimOf("a"), time.Minute); err != nil {
			t.Fatalf("alinamadi: %v", err)
		}
		done := Record{State: StateDone, Fingerprint: "fp", Status: 201, Body: []byte(`{"success":true}`)}
		if written, err := store.Complete(ctx, key, "baskasi", done, time.Hour); err != nil || written {
			t.Errorf("baska jeton bitirememeli: %v %v", written, err)
		}
		if written, err := store.Complete(ctx, key, "a", done, time.Hour); err != nil || !written {
			t.Fatalf("sahibi bitirmeli: %v %v", written, err)
		}
		_, existing, err := store.Claim(ctx, key, claimOf("c"), time.Minute)
		if err != nil || existing.State != StateDone || existing.Status != 201 || string(existing.Body) != `{"success":true}` {
			t.Errorf("bitmis kayit govdesiyle donmeli: %+v %v", existing, err)
		}
		if written, err := store.Complete(ctx, key, "a", done, time.Hour); err != nil || written {
			t.Errorf("bitmis kayit yeniden bitirilemez: %v %v", written, err)
		}
	})

	t.Run("yalnizca sahibi birakir; birakilan anahtar yeniden alinir", func(t *testing.T) {
		store := newStore()
		key := Key("usr_1", "anahtar-03")
		if _, _, err := store.Claim(ctx, key, claimOf("a"), time.Minute); err != nil {
			t.Fatalf("alinamadi: %v", err)
		}
		if released, err := store.Release(ctx, key, "baskasi"); err != nil || released {
			t.Errorf("baska jeton birakamamali: %v %v", released, err)
		}
		if released, err := store.Release(ctx, key, "a"); err != nil || !released {
			t.Fatalf("sahibi birakmali: %v %v", released, err)
		}
		if claimed, _, err := store.Claim(ctx, key, claimOf("b"), time.Minute); err != nil || !claimed {
			t.Errorf("birakilan anahtar yeniden alinmali: %v %v", claimed, err)
		}
	})

	t.Run("suresi dolan kayit duser; eski sahip yeni sahibin ustune yazamaz", func(t *testing.T) {
		store := newStore()
		key := Key("usr_1", "anahtar-04")
		if _, _, err := store.Claim(ctx, key, claimOf("a"), time.Second); err != nil {
			t.Fatalf("alinamadi: %v", err)
		}
		advance(2 * time.Second)
		if claimed, _, err := store.Claim(ctx, key, claimOf("b"), time.Minute); err != nil || !claimed {
			t.Fatalf("suresi dolan kayit yeniden alinmali: %v %v", claimed, err)
		}
		done := Record{State: StateDone, Fingerprint: "fp", Status: 201}
		if written, err := store.Complete(ctx, key, "a", done, time.Hour); err != nil || written {
			t.Errorf("eski sahip yeni sahibin kaydina yazamamali: %v %v", written, err)
		}
	})

	t.Run("bos govde saklanmis sayilir, govdesiz kayit saklanmamis", func(t *testing.T) {
		store := newStore()
		for key, body := range map[string][]byte{"bos-govde-01": {}, "govdesiz-01": nil} {
			if _, _, err := store.Claim(ctx, Key("usr_1", key), claimOf("a"), time.Minute); err != nil {
				t.Fatalf("alinamadi: %v", err)
			}
			done := Record{State: StateDone, Fingerprint: "fp", Status: 204, Body: body}
			if written, err := store.Complete(ctx, Key("usr_1", key), "a", done, time.Hour); err != nil || !written {
				t.Fatalf("bitirilemedi: %v %v", written, err)
			}
			_, existing, err := store.Claim(ctx, Key("usr_1", key), claimOf("b"), time.Minute)
			if err != nil || (existing.Body == nil) != (body == nil) || len(existing.Body) != 0 {
				t.Errorf("%s: govde nil=%v bekleniyordu, gelen %#v (%v)", key, body == nil, existing.Body, err)
			}
		}
	})

	t.Run("kendi jetonuyla yeniden alma alinmis sayilir (cevabi kaybolan SET NX)", func(t *testing.T) {
		store := newStore()
		key := Key("usr_1", "kendi-kaydi-01")
		if _, _, err := store.Claim(ctx, key, claimOf("ayni-jeton"), time.Minute); err != nil {
			t.Fatalf("alinamadi: %v", err)
		}
		if claimed, _, err := store.Claim(ctx, key, claimOf("ayni-jeton"), time.Minute); err != nil || !claimed {
			t.Errorf("kendi jetonuyla kayit alinmis sayilmali: %v %v", claimed, err)
		}
		claimed, existing, err := store.Claim(ctx, key, claimOf("baska-jeton"), time.Minute)
		if err != nil || claimed || existing.Token != "ayni-jeton" {
			t.Errorf("baska jeton icin kayit dolu kalmali: %v %+v %v", claimed, existing, err)
		}
	})

	t.Run("kapsamlar ayri", func(t *testing.T) {
		store := newStore()
		for _, scope := range []string{"usr_1", "usr_2", AnonymousScope} {
			if claimed, _, err := store.Claim(ctx, Key(scope, "ortak-anahtar"), claimOf(scope), time.Minute); err != nil || !claimed {
				t.Errorf("%s kendi anahtarini almali: %v %v", scope, claimed, err)
			}
		}
	})
}

func TestMemoryStoreContract(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)}
	storeContract(t, func() Store { return NewMemory(clock.Now) }, func(d time.Duration) { clock.now = clock.now.Add(d) })
}

func TestMemorySweepsKeysThatNeverComeBack(t *testing.T) {
	// Bir daha sorulmayan anahtarlar birikmemeli: her sweepEvery almada suresi
	// dolanlar silinir.
	clock := &fakeClock{now: time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)}
	store := NewMemory(clock.Now)
	ctx := context.Background()
	for i := range sweepEvery - 1 {
		if _, _, err := store.Claim(ctx, Key("usr_1", fmt.Sprintf("eski-%04d", i)), claimOf("a"), time.Second); err != nil {
			t.Fatalf("alinamadi: %v", err)
		}
	}
	clock.now = clock.now.Add(2 * time.Second)

	if _, _, err := store.Claim(ctx, Key("usr_1", "yeni-0001"), claimOf("b"), time.Minute); err != nil {
		t.Fatalf("alinamadi: %v", err)
	}

	if len(store.records) != 1 {
		t.Errorf("suresi dolan %d kayit supurulmeli, depoda %d kayit kaldi", sweepEvery-1, len(store.records))
	}
}

func TestKeyFormat(t *testing.T) {
	if got := Key("usr_7", "4f1c3a2b-9d8e"); got != "idem:{usr_7}:4f1c3a2b-9d8e" {
		t.Errorf("anahtar bicimi: %q", got)
	}
}
