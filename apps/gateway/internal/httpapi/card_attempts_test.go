package httpapi

import (
	"fmt"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/cards"
)

// Kart ekleme deneme siniri (T11.17, K2, QA G1).

var (
	declined = apperror.New(apperror.CodePaymentDeclined, map[string]string{"reason": "verification_declined"})
	invalid  = apperror.New(apperror.CodeValidationFailed, map[string]string{"number": "Kart numarası geçersiz"})
	conflict = apperror.New(apperror.CodeConflict, map[string]string{"cardId": testCardID})
)

// attempt, kart ekleme denemesi; her deneme kendi anahtariyla. Durum ve Retry-After doner.
func (h *cardsHarness) attempt(t *testing.T, authorization string, n int) (int, string) {
	t.Helper()
	status, headers := h.send(t, cardRequest(t, http.MethodPost, cardsPath, authorization, fmt.Sprintf("anahtar-deneme-%04d", n), cardAddBody))
	return status, headers.Get(fiber.HeaderRetryAfter)
}

func TestFailedVerificationsLockTheUserForAnHour(t *testing.T) {
	h := newCardsHarness(t, cardsOptions{})
	h.vault.addResult = func(int) error { return declined }

	for n := 1; n <= cards.FailuresPerHour; n++ {
		if status, _ := h.attempt(t, bearer(t), n); status != http.StatusPaymentRequired {
			t.Fatalf("%d. deneme kasaya gitmeli (402): %d", n, status)
		}
	}
	status, retryAfter := h.attempt(t, bearer(t), 99)

	if status != http.StatusTooManyRequests {
		t.Fatalf("esikte 429 bekleniyordu: %d", status)
	}
	if seconds, err := strconv.Atoi(retryAfter); err != nil || seconds < 1 || seconds > int(time.Hour/time.Second) {
		t.Errorf("Retry-After (0, 1 sa] olmali: %q", retryAfter)
	}
	if h.vault.addCalls() != cards.FailuresPerHour {
		t.Errorf("kilitliyken kasaya gidilmemeli: %d cagri", h.vault.addCalls())
	}
	results := h.recorder.cardVerifications()
	if len(results) != cards.FailuresPerHour+1 || results[0] != "declined" || results[len(results)-1] != "limited" {
		t.Errorf("metrik sonuclari: %v", results)
	}

	h.advance(time.Hour + time.Minute)
	if status, _ := h.attempt(t, bearer(t), 100); status != http.StatusPaymentRequired {
		t.Errorf("saat dolunca deneme yeniden kasaya gitmeli: %d", status)
	}
}

func TestLockDoesNotAffectOtherUsersAndInvalidCardsCount(t *testing.T) {
	h := newCardsHarness(t, cardsOptions{})
	h.vault.addResult = func(int) error { return invalid }
	for n := 1; n <= cards.FailuresPerHour; n++ {
		h.attempt(t, bearer(t), n)
	}

	locked, _ := h.attempt(t, bearer(t), 50)
	other, _ := h.attempt(t, tokenFor(t, "usr_ffffffffffffffffffffffffffffffff"), 51)

	if locked != http.StatusTooManyRequests {
		t.Errorf("gecersiz kart da basarisiz deneme sayilmali: %d", locked)
	}
	if other != http.StatusBadRequest {
		t.Errorf("baska kullanici etkilenmemeli (kasaya gitmeli, 400): %d", other)
	}
}

func TestSuccessesAndConflictsDoNotCount(t *testing.T) {
	h := newCardsHarness(t, cardsOptions{})
	h.vault.addResult = func(call int) error {
		if call%2 == 0 {
			return conflict
		}
		return nil
	}

	for n := 1; n <= 3*cards.FailuresPerHour; n++ {
		if status, _ := h.attempt(t, bearer(t), n); status == http.StatusTooManyRequests {
			t.Fatalf("%d. deneme: basari ve ayni kart sayilmamali", n)
		}
	}
}

func TestDailyLimitHoldsAcrossHours(t *testing.T) {
	h := newCardsHarness(t, cardsOptions{})
	h.vault.addResult = func(int) error { return declined }
	n := 0
	for range cards.FailuresPerDay / cards.FailuresPerHour {
		for range cards.FailuresPerHour {
			n++
			h.attempt(t, bearer(t), n)
		}
		h.advance(time.Hour + time.Minute)
	}

	status, retryAfter := h.attempt(t, bearer(t), 999)

	if status != http.StatusTooManyRequests {
		t.Fatalf("gunde %d basarisiz denemeden sonra 429 bekleniyordu: %d", cards.FailuresPerDay, status)
	}
	if seconds, err := strconv.Atoi(retryAfter); err != nil || seconds <= int(time.Hour/time.Second) {
		t.Errorf("gunluk kilit saatlikten uzun surmeli: Retry-After %q", retryAfter)
	}
	h.advance(24 * time.Hour)
	if status, _ := h.attempt(t, bearer(t), 1000); status != http.StatusPaymentRequired {
		t.Errorf("gun dolunca deneme kasaya gitmeli: %d", status)
	}
}

func TestIPLimitCountsEveryAttempt(t *testing.T) {
	h := newCardsHarness(t, cardsOptions{})

	for n := 1; n <= cards.AttemptsPerIPPerHour; n++ {
		if status, _ := h.attempt(t, tokenFor(t, fmt.Sprintf("usr_%032x", n)), n); status != http.StatusCreated {
			t.Fatalf("%d. deneme kabul edilmeli: %d", n, status)
		}
	}
	status, retryAfter := h.attempt(t, bearer(t), 999)

	if status != http.StatusTooManyRequests || retryAfter == "" {
		t.Errorf("IP basina %d denemeden sonra 429 ve Retry-After: %d %q", cards.AttemptsPerIPPerHour, status, retryAfter)
	}
}

func TestParallelAttemptsOfOneUserAreSerialized(t *testing.T) {
	// Guvenlik incelemesi: ayni kullanicinin es zamanli denemeleri bakma adiminda
	// bos sayac gorup siniri bir patlamada asamaz; ayni anda tek dogrulama.
	h := newCardsHarness(t, cardsOptions{})
	entered, release := make(chan struct{}), make(chan struct{})
	h.vault.addResult = func(call int) error {
		if call == 1 {
			close(entered)
			<-release
		}
		return declined
	}
	first := make(chan int, 1)
	request := cardRequest(t, http.MethodPost, cardsPath, bearer(t), "anahtar-paralel-0001", cardAddBody)
	go func() {
		response, err := h.app.Test(request, fiber.TestConfig{Timeout: 0})
		if err != nil {
			first <- 0
			return
		}
		if closeErr := response.Body.Close(); closeErr != nil {
			first <- 0
			return
		}
		first <- response.StatusCode
	}()
	<-entered

	parallel, err := h.app.Test(cardRequest(t, http.MethodPost, cardsPath, bearer(t), "anahtar-paralel-0002", cardAddBody))
	if err != nil {
		t.Fatalf("istek: %v", err)
	}
	retryAfter := parallel.Header.Get(fiber.HeaderRetryAfter)
	envelope := decode(t, parallel)
	other, _ := h.attempt(t, tokenFor(t, "usr_ffffffffffffffffffffffffffffffff"), 3)
	close(release)

	// Govde K2 siniriyla AYNI bicim: web ayni yoldan isler (Zod).
	details, _ := envelope.Error.Details.(map[string]any)
	if parallel.StatusCode != http.StatusTooManyRequests || retryAfter != "1" ||
		envelope.Error.Code != apperror.CodeRateLimited || details[apperror.RetryAfterDetail] != float64(1) {
		t.Errorf("es zamanli deneme 429, Retry-After 1 ve RATE_LIMITED {retryAfterSeconds: 1} almali: %d %q %+v",
			parallel.StatusCode, retryAfter, envelope.Error)
	}
	if other != http.StatusPaymentRequired {
		t.Errorf("baska kullanici beklemeden kasaya gitmeli: %d", other)
	}
	if status := <-first; status != http.StatusPaymentRequired {
		t.Errorf("ilk deneme tamamlanmali (402): %d", status)
	}
	if h.vault.addCalls() != 2 {
		t.Errorf("kasaya yalnizca ilk deneme ve baska kullanici gitmeli: %d", h.vault.addCalls())
	}
	if next, _ := h.attempt(t, bearer(t), 4); next != http.StatusPaymentRequired {
		t.Errorf("kilit birakilinca yeni deneme kasaya gitmeli: %d", next)
	}
}
