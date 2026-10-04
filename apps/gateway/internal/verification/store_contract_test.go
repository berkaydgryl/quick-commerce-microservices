package verification

import (
	"sync"
	"testing"
	"time"
)

// Depo sozlesmesi: bellek (memory_test.go, sahte saat) ve Redis
// (redis_integration_test.go, gercek saat) AYNI testlerden gecer. Sureler
// cagirandan gelir: Redis'te gercek beklemeyle sinanacak kadar kisadir.

// storeHarness, bir deponun sozlesme testine verdigi parcalar.
type storeHarness struct {
	// newStore, bos depo (her alt test kendi deposunu ve kullanicisini alir).
	newStore func(t *testing.T) Store
	// pass, saatin ilerlemesi: bellekte sahte saat, Redis'te uyku.
	pass func(t *testing.T, d time.Duration)
	// ttl ve resendAfter, sinanan sureler.
	ttl, resendAfter time.Duration
	// newUserID, alt testler arasinda carpismayan kullanici.
	newUserID func() string
}

var (
	pendingA = Pending{Address: "ayse@ornek.com", CodeHash: "ozet-a"}
	pendingB = Pending{Address: "ayse@ornek.com", CodeHash: "ozet-b"}
)

func runStoreContract(t *testing.T, h storeHarness) {
	t.Run("ilk kod yazilir, dogru kod bir kez dogrulanir", func(t *testing.T) {
		store, user := h.newStore(t), h.newUserID()
		mustStart(t, store, user, pendingA, h)

		expectOutcome(t, store, user, pendingA, Outcome{Result: ResultVerified})
		expectOutcome(t, store, user, pendingA, Outcome{Result: ResultExpired})
	})

	t.Run("bekleme bitmeden yeni kod yazilmaz, eski kod gecerli kalir", func(t *testing.T) {
		store, user := h.newStore(t), h.newUserID()
		mustStart(t, store, user, pendingA, h)

		wait, err := store.Start(t.Context(), user, pendingB, h.ttl, h.resendAfter)
		if err != nil || wait <= 0 || wait > h.resendAfter {
			t.Fatalf("kalan bekleme (0, %v] olmali: %v (%v)", h.resendAfter, wait, err)
		}
		expectOutcome(t, store, user, pendingB, Outcome{Result: ResultWrong, AttemptsLeft: MaxAttempts - 1})
		expectOutcome(t, store, user, pendingA, Outcome{Result: ResultVerified})
	})

	t.Run("bekleme bitince yeni kod eskinin yerine gecer, haklar sifirlanir", func(t *testing.T) {
		store, user := h.newStore(t), h.newUserID()
		mustStart(t, store, user, pendingA, h)
		expectOutcome(t, store, user, pendingB, Outcome{Result: ResultWrong, AttemptsLeft: MaxAttempts - 1})

		h.pass(t, h.resendAfter)
		mustStart(t, store, user, pendingB, h)

		expectOutcome(t, store, user, pendingA, Outcome{Result: ResultWrong, AttemptsLeft: MaxAttempts - 1})
		expectOutcome(t, store, user, pendingB, Outcome{Result: ResultVerified})
	})

	t.Run("baska adrese girilen kod suresi dolmus sayilir ve hak yemez", func(t *testing.T) {
		store, user := h.newStore(t), h.newUserID()
		mustStart(t, store, user, pendingA, h)

		expectOutcome(t, store, user, Pending{Address: "baska@ornek.com", CodeHash: pendingA.CodeHash}, Outcome{Result: ResultExpired})
		expectOutcome(t, store, user, pendingB, Outcome{Result: ResultWrong, AttemptsLeft: MaxAttempts - 1})
	})

	t.Run("son yanlista kod kilitlenir; dogru kod da artik gecmez; bekleme surer", func(t *testing.T) {
		store, user := h.newStore(t), h.newUserID()
		mustStart(t, store, user, pendingA, h)
		for left := MaxAttempts - 1; left > 0; left-- {
			expectOutcome(t, store, user, pendingB, Outcome{Result: ResultWrong, AttemptsLeft: left})
		}

		expectOutcome(t, store, user, pendingB, Outcome{Result: ResultLocked})
		expectOutcome(t, store, user, pendingA, Outcome{Result: ResultLocked})
		if wait, err := store.Start(t.Context(), user, pendingB, h.ttl, h.resendAfter); err != nil || wait <= 0 {
			t.Fatalf("kilit beklemeyi sifirlamamali: %v (%v)", wait, err)
		}
	})

	t.Run("omur dolunca kod gecersizdir ve yeni kod hemen istenebilir", func(t *testing.T) {
		store, user := h.newStore(t), h.newUserID()
		mustStart(t, store, user, pendingA, h)

		h.pass(t, h.ttl)

		expectOutcome(t, store, user, pendingA, Outcome{Result: ResultExpired})
		mustStart(t, store, user, pendingB, h)
	})

	t.Run("Discard yalnizca ayni ozetli kodu siler", func(t *testing.T) {
		store, user := h.newStore(t), h.newUserID()
		mustStart(t, store, user, pendingA, h)

		if err := store.Discard(t.Context(), user, pendingB.CodeHash); err != nil {
			t.Fatalf("Discard: %v", err)
		}
		expectOutcome(t, store, user, pendingA, Outcome{Result: ResultVerified})

		other := h.newUserID()
		mustStart(t, store, other, pendingA, h)
		if err := store.Discard(t.Context(), other, pendingA.CodeHash); err != nil {
			t.Fatalf("Discard: %v", err)
		}
		// Silinen kodun beklemesi de gider: kullanici hemen yeniden ister.
		mustStart(t, store, other, pendingB, h)
	})

	t.Run("PendingAddress: kayit yasadikca adres (kilitte de), sonra bos", func(t *testing.T) {
		store, user := h.newStore(t), h.newUserID()
		expectAddress(t, store, user, "")
		mustStart(t, store, user, pendingA, h)
		expectAddress(t, store, user, pendingA.Address)
		expectAddress(t, store, h.newUserID(), "")

		for range MaxAttempts {
			if _, err := store.Check(t.Context(), user, pendingB, MaxAttempts); err != nil {
				t.Fatalf("Check: %v", err)
			}
		}
		expectOutcome(t, store, user, pendingA, Outcome{Result: ResultLocked})
		expectAddress(t, store, user, pendingA.Address)

		h.pass(t, h.ttl)
		expectAddress(t, store, user, "")

		verified := h.newUserID()
		mustStart(t, store, verified, pendingA, h)
		expectOutcome(t, store, verified, pendingA, Outcome{Result: ResultVerified})
		expectAddress(t, store, verified, "")
	})

	t.Run("es zamanli yanlis denemeler hakki asamaz", func(t *testing.T) {
		store, user := h.newStore(t), h.newUserID()
		mustStart(t, store, user, pendingA, h)

		const attempts = 20
		results := make(chan Outcome, attempts)
		var wg sync.WaitGroup
		for range attempts {
			wg.Add(1)
			go func() {
				defer wg.Done()
				outcome, err := store.Check(t.Context(), user, pendingB, MaxAttempts)
				if err != nil {
					t.Errorf("Check: %v", err)
				}
				results <- outcome
			}()
		}
		wg.Wait()
		close(results)

		counts := map[Result]int{}
		for outcome := range results {
			counts[outcome.Result]++
		}
		if counts[ResultWrong] != MaxAttempts-1 || counts[ResultLocked] != attempts-(MaxAttempts-1) {
			t.Errorf("%d yanlis + %d kilit bekleniyordu: %v", MaxAttempts-1, attempts-(MaxAttempts-1), counts)
		}
	})

	t.Run("es zamanli gonderimlerden yalnizca biri kod yazar", func(t *testing.T) {
		store, user := h.newStore(t), h.newUserID()

		const senders = 10
		written := make(chan bool, senders)
		var wg sync.WaitGroup
		for index := range senders {
			wg.Add(1)
			go func() {
				defer wg.Done()
				pending := Pending{Address: pendingA.Address, CodeHash: "ozet-" + string(rune('a'+index))}
				wait, err := store.Start(t.Context(), user, pending, h.ttl, h.resendAfter)
				if err != nil {
					t.Errorf("Start: %v", err)
				}
				written <- wait == 0
			}()
		}
		wg.Wait()
		close(written)

		count := 0
		for ok := range written {
			if ok {
				count++
			}
		}
		if count != 1 {
			t.Errorf("tam bir yazim bekleniyordu: %d", count)
		}
	})
}

func mustStart(t *testing.T, store Store, user string, pending Pending, h storeHarness) {
	t.Helper()
	if wait, err := store.Start(t.Context(), user, pending, h.ttl, h.resendAfter); err != nil || wait != 0 {
		t.Fatalf("kod yazilmaliydi: bekleme %v (%v)", wait, err)
	}
}

func expectAddress(t *testing.T, store Store, user, want string) {
	t.Helper()
	got, err := store.PendingAddress(t.Context(), user)
	if err != nil || got != want {
		t.Fatalf("bekleyen adres %q bekleniyordu: %q (%v)", want, got, err)
	}
}

func expectOutcome(t *testing.T, store Store, user string, pending Pending, want Outcome) {
	t.Helper()
	got, err := store.Check(t.Context(), user, pending, MaxAttempts)
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if got != want {
		t.Fatalf("sonuc %+v, beklenen %+v", got, want)
	}
}
