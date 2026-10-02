package geo

import (
	"context"
	"errors"
	"sync"
	"time"
)

// errQueueFull, siradaki yer istegin ust sinirindan sonra: beklemek bosuna.
var errQueueFull = errors.New("adres servisi sirasi dolu")

// throttle, Nominatim'e giden istekleri tek siraya dizer: iki istek arasinda
// en az interval gecer (kullanim kosulu: saniyede en fazla bir istek). Her
// cagri siradaki ilk bos yeri ayirir ve o ana kadar bekler.
type throttle struct {
	mu       sync.Mutex
	interval time.Duration
	next     time.Time
}

func newThrottle(interval time.Duration) *throttle {
	return &throttle{interval: interval}
}

// wait, siradaki yeri ayirir ve beklemeyi bitirir. Yer baglamin bitis
// zamanindan sonraysa hic ayirmadan errQueueFull doner (sira uzamaz);
// beklerken baglam biterse onun hatasi doner (ayrilan yer bos gecer: kosul
// yine korunur).
func (t *throttle) wait(ctx context.Context) error {
	t.mu.Lock()
	now := time.Now()
	slot := t.next
	if slot.Before(now) {
		slot = now
	}
	if deadline, bounded := ctx.Deadline(); bounded && slot.After(deadline) {
		t.mu.Unlock()
		return errQueueFull
	}
	t.next = slot.Add(t.interval)
	t.mu.Unlock()

	delay := slot.Sub(now)
	if delay <= 0 {
		return ctx.Err()
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
