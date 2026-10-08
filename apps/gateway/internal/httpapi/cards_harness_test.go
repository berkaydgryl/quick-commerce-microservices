package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/cards"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ratelimit"
)

// Kart uclarinin (T11.17) test duzenegi: sahte kasa, gercek jeton dogrulayici,
// bellek sayaci (sahte saat) ve tekrar korumasi.

const (
	cardsPath   = "/v1/me/cards"
	testCardID  = "crd_0123456789abcdef0123456789abcdef"
	cardAddBody = `{"number":"3782 822463 10005","expiryMonth":12,"expiryYear":2031,"cvv":"9183","holderName":"Zeynep Kılıçarslan","nickname":"Gizli Maaş"}`
)

// fakeCardVault, kasanin sahtesi: cagrilari ve kullaniciyi saklar; ekleme
// cevabi addResult'tan, ad duzenleme cevabi renameResult'tan (verilmezse
// maskeli kart).
type fakeCardVault struct {
	mu           sync.Mutex
	users        []string
	inputs       []cards.AddInput
	deleted      []string
	renames      []cardRename
	addResult    func(call int) error
	renameResult error
}

// cardRename, kasaya giden ad duzenlemesi; nickname nil ise alan eksik gitti.
type cardRename struct {
	cardID   string
	nickname *string
}

func (f *fakeCardVault) AddCard(_ context.Context, userID string, input cards.AddInput) (cards.SavedCard, error) {
	f.mu.Lock()
	f.users = append(f.users, userID)
	f.inputs = append(f.inputs, input)
	call, result := len(f.inputs), f.addResult
	f.mu.Unlock()
	// Cevap kilit DISINDA: eszamanlilik testi kasayi bekletebilsin.
	if result != nil {
		if err := result(call); err != nil {
			return cards.SavedCard{}, err
		}
	}
	return savedTestCard(), nil
}

func (f *fakeCardVault) ListCards(_ context.Context, userID string) (cards.SavedCardList, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.users = append(f.users, userID)
	return cards.SavedCardList{Items: []cards.SavedCard{savedTestCard()}}, nil
}

func (f *fakeCardVault) DeleteCard(_ context.Context, userID, cardID string) (cards.SavedCardList, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.users = append(f.users, userID)
	f.deleted = append(f.deleted, cardID)
	return cards.SavedCardList{Items: []cards.SavedCard{}}, nil
}

func (f *fakeCardVault) UpdateCardNickname(_ context.Context, userID, cardID string, nickname *string) (cards.SavedCard, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.users = append(f.users, userID)
	f.renames = append(f.renames, cardRename{cardID: cardID, nickname: nickname})
	if f.renameResult != nil {
		return cards.SavedCard{}, f.renameResult
	}
	card := savedTestCard()
	if nickname != nil {
		card.Nickname = *nickname
	}
	return card, nil
}

func (f *fakeCardVault) renameCalls() []cardRename {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]cardRename(nil), f.renames...)
}

func (f *fakeCardVault) addCalls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.inputs)
}

func savedTestCard() cards.SavedCard {
	return cards.SavedCard{
		ID: testCardID, Brand: "AMEX", First4: "3782", Last4: "0005", ExpiryMonth: 12, ExpiryYear: 2031,
		HolderName: "Zeynep Kılıçarslan", Expired: false, CreatedAt: "2026-10-05T12:00:00Z",
	}
}

// cardsHarness, kurulmus uygulama ve gozlemcileri.
type cardsHarness struct {
	app      *fiber.App
	vault    *fakeCardVault
	recorder *recordingMetrics
	store    *recordingIdempotencyStore
	clock    *time.Time
}

// cardsOptions, duzenegin degisebilen parcalari.
type cardsOptions struct {
	logger *slog.Logger
	// general, kullanici basina genel sinir (pencere 1 dk); sifirsa fiilen sinirsiz.
	general int
	// renamer, ad duzenlemenin kasasi; nil ise sahte kasa (gercek cards.Service
	// verilirse hata gercek gRPC yolundan gecer).
	renamer CardRenamer
}

func newCardsHarness(t *testing.T, options cardsOptions) *cardsHarness {
	t.Helper()
	now := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	clock := &now
	counter := ratelimit.NewMemory(func() time.Time { return *clock })
	vault := &fakeCardVault{}
	recorder := &recordingMetrics{}
	store := &recordingIdempotencyStore{inner: idempotency.NewMemory(time.Now)}
	logger := options.logger
	if logger == nil {
		logger = silentLogger()
	}
	general := options.general
	if general == 0 {
		general = 10000
	}
	var renamer CardRenamer = vault
	if options.renamer != nil {
		renamer = options.renamer
	}
	app := New(Deps{
		Health:       fakeReporter{report: healthyReport()},
		Cards:        CardRoutes{Lister: vault, Adder: vault, Deleter: vault, Renamer: renamer, Failures: counter, Inflight: counter},
		AccessTokens: testTokens(),
		Idempotency:  Idempotency{Store: store, FingerprintKey: testFingerprintKey, TTL: 24 * time.Hour},
		RateLimit:    RateLimit{Limiter: counter, Window: time.Minute, General: general, Auth: 10000, Order: 10000},
		Logger:       logger,
		Metrics:      recorder,
	})
	return &cardsHarness{app: app, vault: vault, recorder: recorder, store: store, clock: clock}
}

// advance, sayacin sahte saatini ilerletir.
func (h *cardsHarness) advance(d time.Duration) {
	*h.clock = h.clock.Add(d)
}

// tokenFor, verilen kullanici icin Authorization degeri.
func tokenFor(t *testing.T, userID string) string {
	t.Helper()
	token, err := testTokens().Issue(auth.Identity{UserID: userID, SessionID: testSessionID})
	if err != nil {
		t.Fatalf("jeton uretilemedi: %v", err)
	}
	return bearerScheme + " " + token
}

// cardRequest, kart ucuna istek; key bossa Idempotency-Key yok, body bossa govdesiz.
func cardRequest(t *testing.T, method, target, authorization, key, body string) *http.Request {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := newRequest(t, method, target, reader)
	if body != "" {
		request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	}
	if authorization != "" {
		request.Header.Set(fiber.HeaderAuthorization, authorization)
	}
	if key != "" {
		request.Header.Set(IdempotencyKeyHeader, key)
	}
	return request
}

// envelope, istegi verir ve zarfi okur (govde decode'da kapanir).
func (h *cardsHarness) envelope(t *testing.T, request *http.Request) Envelope {
	t.Helper()
	_, envelope := h.statusAndEnvelope(t, request)
	return envelope
}

// statusAndEnvelope, istegi verir; durum ve zarf (govde decode'da kapanir).
func (h *cardsHarness) statusAndEnvelope(t *testing.T, request *http.Request) (int, Envelope) {
	t.Helper()
	response, err := h.app.Test(request)
	if err != nil {
		t.Fatalf("istek: %v", err)
	}
	return response.StatusCode, decode(t, response)
}

// rawBody, istegi verir; durum ve ham govde (govde BURADA kapanir).
func (h *cardsHarness) rawBody(t *testing.T, request *http.Request) (int, string) {
	t.Helper()
	response, err := h.app.Test(request)
	if err != nil {
		t.Fatalf("istek: %v", err)
	}
	raw, readErr := io.ReadAll(response.Body)
	if closeErr := response.Body.Close(); closeErr != nil {
		t.Errorf("cevap govdesi kapatilamadi: %v", closeErr)
	}
	if readErr != nil {
		t.Fatalf("govde okunamadi: %v", readErr)
	}
	return response.StatusCode, string(raw)
}

// send, istegi verir ve govdeyi BURADA kapatir (bodyclose); durum ve basliklar doner.
func (h *cardsHarness) send(t *testing.T, request *http.Request) (int, http.Header) {
	t.Helper()
	response, err := h.app.Test(request)
	if err != nil {
		t.Fatalf("istek: %v", err)
	}
	if closeErr := response.Body.Close(); closeErr != nil {
		t.Errorf("cevap govdesi kapatilamadi: %v", closeErr)
	}
	return response.StatusCode, response.Header
}

// recordingIdempotencyStore, tekrar korumasi kayitlarini ve omurlerini saklar (G2).
type recordingIdempotencyStore struct {
	inner idempotency.Store
	mu    sync.Mutex
	saved []idempotency.Record
	ttls  []time.Duration
}

func (s *recordingIdempotencyStore) Claim(ctx context.Context, key string, claim idempotency.Record, ttl time.Duration) (bool, idempotency.Record, error) {
	s.remember(claim, ttl)
	return s.inner.Claim(ctx, key, claim, ttl)
}

func (s *recordingIdempotencyStore) Complete(ctx context.Context, key, token string, done idempotency.Record, ttl time.Duration) (bool, error) {
	s.remember(done, ttl)
	return s.inner.Complete(ctx, key, token, done, ttl)
}

func (s *recordingIdempotencyStore) Release(ctx context.Context, key, token string) (bool, error) {
	return s.inner.Release(ctx, key, token)
}

func (s *recordingIdempotencyStore) remember(record idempotency.Record, ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.saved = append(s.saved, record)
	s.ttls = append(s.ttls, ttl)
}
