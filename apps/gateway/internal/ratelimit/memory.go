package ratelimit

import (
	"context"
	"sync"
	"time"
)

// sweepEvery, kac cagrida bir bos kalan sayaclarin supurulecegi. Bir daha
// gelmeyen istemcinin sayaci yalnizca kendi anahtari sorulunca temizlenseydi
// surec boyunca birikirdi. Redis'te bu is anahtarin suresidir (PEXPIRE).
const sweepEvery = 256

// Memory, bellek sayaci: MOCK=true ve testler icin. Kurallari Redis'tekiyle
// AYNIDIR; ama her gateway orneginin kendi sayaci olur (P2'nin anlattigi
// gevseme): yalnizca tek ornekli gelistirme icindir.
type Memory struct {
	mu       sync.Mutex
	now      func() time.Time
	counters map[string]*memoryCounter
	calls    int
}

type memoryCounter struct {
	// hits, penceredeki kabul edilmis isteklerin zamanlari (eskiden yeniye).
	hits   []time.Time
	window time.Duration
}

// NewMemory, verilen saatle bos sayac kurar.
func NewMemory(now func() time.Time) *Memory {
	return &Memory{now: now, counters: map[string]*memoryCounter{}}
}

// Allow, istegi kabul ederse pencereye yazar; etmezse yazmaz.
func (m *Memory) Allow(_ context.Context, key string, limit int, window time.Duration) (Decision, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	m.calls++
	if m.calls%sweepEvery == 0 {
		m.sweep(now)
	}

	counter, found := m.counters[key]
	if !found {
		counter = &memoryCounter{}
		m.counters[key] = counter
	}
	counter.window = window
	counter.hits = live(counter.hits, now, window)
	if len(counter.hits) < limit {
		counter.hits = append(counter.hits, now)
		return Decision{Allowed: true}, nil
	}
	return Decision{RetryAfter: retryAfter(counter.hits[0], now, window)}, nil
}

// live, penceredeki kayitlar: an, (simdi - pencere)'den SONRA olmali.
func live(hits []time.Time, now time.Time, window time.Duration) []time.Time {
	cutoff := now.Add(-window)
	first := 0
	for first < len(hits) && !hits[first].After(cutoff) {
		first++
	}
	return hits[first:]
}

// retryAfter, en eski kaydin pencereden dusmesine kalan sure (en az 1 ms).
func retryAfter(oldest, now time.Time, window time.Duration) time.Duration {
	if wait := oldest.Add(window).Sub(now); wait > time.Millisecond {
		return wait
	}
	return time.Millisecond
}

// sweep, penceresi tamamen gecmis sayaclari siler (kilit altinda).
func (m *Memory) sweep(now time.Time) {
	for key, counter := range m.counters {
		if len(live(counter.hits, now, counter.window)) == 0 {
			delete(m.counters, key)
		}
	}
}
