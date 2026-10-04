package emailverify

import (
	"sync"
	"testing"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// fakeClock, elle ilerleyen saat; es zamanli okumaya karsi kilitli.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newFakeClock() *fakeClock {
	return &fakeClock{now: time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func TestMemoryStoreContract(t *testing.T) {
	clock := newFakeClock()
	runStoreContract(t, storeHarness{
		newStore:    func(*testing.T) Store { return NewMemory(clock.Now) },
		pass:        func(_ *testing.T, d time.Duration) { clock.Advance(d) },
		ttl:         CodeTTL,
		resendAfter: ResendAfter,
		newUserID:   func() string { return ids.New(ids.User) },
	})
}

func TestMemoryStoreDropsExpiredRecordOnTouch(t *testing.T) {
	clock := newFakeClock()
	store := NewMemory(clock.Now)
	user := ids.New(ids.User)
	mustStart(t, store, user, pendingA, storeHarness{ttl: CodeTTL, resendAfter: ResendAfter})

	clock.Advance(CodeTTL)
	expectOutcome(t, store, user, pendingA, Outcome{Result: ResultExpired})

	if len(store.pending) != 0 {
		t.Errorf("suresi dolan kayit silinmeli (Redis'te TTL): %d kayit", len(store.pending))
	}
}
