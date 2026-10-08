package httpapi

import (
	"bytes"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/cards"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Kart verisi gateway'de hicbir yere yazilmaz (T11.17): tekrar korumasi kaydi
// (QA G2, K3) ve gunluk (QA G3). Kisa sirlar (CVV) rastgele kimliklerden
// arindirilmis metinde aranir (testkit.WithoutRandomNoise).

// cardSecrets, cardAddBody'deki kart verisi ve parcalari.
var cardSecrets = []string{"378282246310005", "3782 822463 10005", "822463", "9183", "Kılıçarslan", "Gizli Maaş"}

func assertNoCardSecrets(t *testing.T, where, text string) {
	t.Helper()
	masked := testkit.WithoutRandomNoise(text)
	for _, secret := range cardSecrets {
		if strings.Contains(masked, secret) {
			t.Errorf("%s: kart verisi (%d karakter) bulundu", where, len(secret))
		}
	}
}

func TestIdempotencyRecordHoldsNoCardNumberOrCVVAndLivesShort(t *testing.T) {
	h := newCardsHarness(t, cardsOptions{})

	h.send(t, cardRequest(t, http.MethodPost, cardsPath, bearer(t), "anahtar-kayit-0001", cardAddBody))

	// Parmak izi maskeli govdenin (CVV'siz) anahtarli HMAC'i; jeton rastgele (#194).
	assertRecordSecrets(t, h.store.saved, expectedFingerprint(http.MethodPost, cardsPath, cards.FingerprintBody([]byte(cardAddBody))))
	// Saklanan cevap maskeli karttir; kart sahibinin adi cevapta zaten vardir.
	assertNoCardSecrets(t, "tekrar kaydi", strings.ReplaceAll(searchableRecords(t, h.store.saved), "Zeynep Kılıçarslan", ""))
	if len(h.store.ttls) == 0 {
		t.Fatal("kayit yazilmadi")
	}
	for _, ttl := range h.store.ttls {
		if ttl > cards.IdempotencyTTL {
			t.Errorf("kart ekleme kaydi en fazla %v yasamali: %v", cards.IdempotencyTTL, ttl)
		}
	}
}

func TestSameKeyReplaysTheMaskedCardAndDifferentCardConflicts(t *testing.T) {
	h := newCardsHarness(t, cardsOptions{})
	key := "anahtar-tekrar-0001"

	h.send(t, cardRequest(t, http.MethodPost, cardsPath, bearer(t), key, cardAddBody))
	// Yalnizca CVV'si farkli ayni kart ayni istek sayilir (parmak izinde CVV yok).
	replayed, replayHeaders := h.send(t, cardRequest(t, http.MethodPost, cardsPath, bearer(t), key, strings.Replace(cardAddBody, `"9183"`, `"1234"`, 1)))
	other, _ := h.send(t, cardRequest(t, http.MethodPost, cardsPath, bearer(t), key, strings.Replace(cardAddBody, "10005", "10013", 1)))

	if replayed != http.StatusCreated || replayHeaders.Get(IdempotentReplayedHeader) != "true" {
		t.Errorf("ayni anahtar ilk cevabi tekrar etmeli: %d %q", replayed, replayHeaders.Get(IdempotentReplayedHeader))
	}
	if other != http.StatusConflict {
		t.Errorf("ayni anahtar + farkli kart 409 olmali: %d", other)
	}
	if h.vault.addCalls() != 1 {
		t.Errorf("kasaya bir kez gidilmeli: %d", h.vault.addCalls())
	}
}

// lockedBuffer, eszamanli yazimlara karsi kilitli gunluk tamponu.
type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func TestCardFlowsWriteNoCardDataToTheLog(t *testing.T) {
	// G3: ekleme, red, gecersiz govde, liste, silme, kimliksiz ve kilit yollarinda
	// (DEBUG dahil) hicbir satir govdeyi, numarayi, CVV'yi, adi ve kart adini tasimaz.
	var output lockedBuffer
	logger := slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug}))
	h := newCardsHarness(t, cardsOptions{logger: logger})
	h.vault.addResult = func(call int) error {
		if call > 1 {
			return declined
		}
		return nil
	}
	requests := []*http.Request{
		cardRequest(t, http.MethodPost, cardsPath, bearer(t), "anahtar-gunluk-0001", cardAddBody),
		cardRequest(t, http.MethodPost, cardsPath, bearer(t), "anahtar-gunluk-0002", strings.Replace(cardAddBody, `"cvv":"9183"`, `"cvv":9183`, 1)),
		cardRequest(t, http.MethodGet, cardsPath, bearer(t), "", ""),
		cardRequest(t, http.MethodDelete, cardsPath+"/"+testCardID, bearer(t), "anahtar-gunluk-0003", ""),
		cardRequest(t, http.MethodPost, cardsPath, "", "anahtar-gunluk-0004", cardAddBody),
	}
	for n := 5; n <= 5+cards.FailuresPerHour; n++ {
		requests = append(requests, cardRequest(t, http.MethodPost, cardsPath, bearer(t), fmt.Sprintf("anahtar-gunluk-%04d", n), cardAddBody))
	}
	for _, request := range requests {
		h.send(t, request)
	}

	text := output.String()
	if strings.Count(text, "http istegi") < len(requests) {
		t.Fatalf("her istek gunlukte bir satir olmali:\n%s", text)
	}
	assertNoCardSecrets(t, "gunluk", text)
}

func TestCardDeleteRecordAlsoLivesShort(t *testing.T) {
	// QA L3: silme cevabi maskeli kart listesidir; kaydi eklemeyle ayni kisa omurlu.
	h := newCardsHarness(t, cardsOptions{})

	status, _ := h.send(t, cardRequest(t, http.MethodDelete, cardsPath+"/"+testCardID, bearer(t), "anahtar-silme-0001", ""))

	if status != http.StatusOK || len(h.store.ttls) == 0 {
		t.Fatalf("silme kaydi yazilmadi: %d", status)
	}
	for _, ttl := range h.store.ttls {
		if ttl > cards.IdempotencyTTL {
			t.Errorf("kart silme kaydi en fazla %v yasamali: %v", cards.IdempotencyTTL, ttl)
		}
	}
}

func TestDecodeErrorsDoNotLogOrEchoTheValue(t *testing.T) {
	// QA L4: kart numarasi yanlis alana (ay, yil) ya da govdenin yerine yazilirsa
	// cozme hatasi degeri ne gunluge ne cevaba tasir; yalnizca alan adi.
	var output lockedBuffer
	logger := slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug}))
	h := newCardsHarness(t, cardsOptions{logger: logger})
	bodies := []string{
		`{"number":"","expiryMonth":4242424242424242}`,
		`{"expiryYear":4242424242424242.5}`,
		`4242424242424242`,
	}
	var responses strings.Builder
	for n, body := range bodies {
		status, raw := h.rawBody(t, cardRequest(t, http.MethodPost, cardsPath, bearer(t), fmt.Sprintf("anahtar-cozme-%04d", n), body))
		if status != http.StatusBadRequest {
			t.Errorf("%s: 400 bekleniyordu: %d", body, status)
		}
		responses.WriteString(raw)
	}

	for where, text := range map[string]string{"gunluk": output.String(), "cevap": responses.String()} {
		if strings.Contains(testkit.WithoutRandomNoise(text), "4242") {
			t.Errorf("%s: girilen deger yankilandi", where)
		}
	}
	if !strings.Contains(responses.String(), `"expiryMonth"`) {
		t.Errorf("cevap alan adini gostermeli: %s", responses.String())
	}
	if h.vault.addCalls() != 0 {
		t.Error("cozulemeyen govde kasaya gitmemeli")
	}
}
