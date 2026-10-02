package geo

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"
)

func TestThrottleSpacesCallsByInterval(t *testing.T) {
	// Zamanlayici hicbir zaman erken calmaz: k. cagri baslangictan en az
	// k*interval sonra biter. Esitsizlik makine yavas olsa da bozulmaz.
	const interval, calls = 40 * time.Millisecond, 4
	th := newThrottle(interval)
	start := time.Now()

	var mu sync.Mutex
	var finished []time.Duration
	var wg sync.WaitGroup
	for range calls {
		wg.Go(func() {
			if err := th.wait(context.Background()); err != nil {
				t.Errorf("bekleme basarisiz: %v", err)
			}
			mu.Lock()
			finished = append(finished, time.Since(start))
			mu.Unlock()
		})
	}
	wg.Wait()

	slices.Sort(finished)
	for k, elapsed := range finished {
		if elapsed < time.Duration(k)*interval {
			t.Errorf("%d. cagri %v sonra bitti, en erken %v olmali", k, elapsed, time.Duration(k)*interval)
		}
	}
}

func TestThrottleRefusesSlotAfterDeadlineWithoutQueueing(t *testing.T) {
	th := newThrottle(time.Hour)
	if err := th.wait(context.Background()); err != nil {
		t.Fatalf("ilk cagri beklememeli: %v", err)
	}
	next := th.next

	// Siradaki yer bir saat sonra, baglam bir dakika: beklemek bosuna.
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	began := time.Now()
	err := th.wait(ctx)

	if !errors.Is(err, errQueueFull) || time.Since(began) > 30*time.Second {
		t.Errorf("sira dolu hemen donmeli: %v %v", err, time.Since(began))
	}
	if !th.next.Equal(next) {
		t.Error("reddedilen cagri siraya yer ayirmamali")
	}
}
