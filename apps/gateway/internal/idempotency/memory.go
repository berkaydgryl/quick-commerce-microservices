package idempotency

import (
	"context"
	"sync"
	"time"
)

// sweepEvery, kac almada bir suresi dolan kayitlarin supurulecegi. Suresi
// dolan kayit yalnizca ayni anahtar yeniden sorulunca silinseydi, bir daha
// gelmeyen anahtarlar (neredeyse hepsi) surec boyunca birikirdi. Redis'te
// bu is Redis'in kendi suresidir (PX).
const sweepEvery = 256

// Memory, bellek deposu: MOCK=true ve testler icin. Kurallari Redis'tekiyle
// AYNIDIR (atomik alma, jetonla bitirme ve birakma, omur); surec kapaninca
// kayitlar kaybolur ve birden fazla gateway ornegi arasinda paylasilmaz.
type Memory struct {
	mu      sync.Mutex
	now     func() time.Time
	records map[string]memoryEntry
	claims  int
}

type memoryEntry struct {
	record    Record
	expiresAt time.Time
}

// NewMemory, verilen saatle bos depo kurar.
func NewMemory(now func() time.Time) *Memory {
	return &Memory{now: now, records: map[string]memoryEntry{}}
}

// Claim, anahtar bos ya da suresi dolmussa alir.
func (m *Memory) Claim(_ context.Context, key string, claim Record, ttl time.Duration) (bool, Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.claims++
	if m.claims%sweepEvery == 0 {
		m.sweep()
	}
	if current, found := m.live(key); found {
		if current.State == StateInProgress && current.Token == claim.Token {
			// Redis deposuyla ayni kural: kendi jetonunu tasiyan kayit alinmistir.
			return true, Record{}, nil
		}
		return false, current, nil
	}
	m.records[key] = memoryEntry{record: claim, expiresAt: m.now().Add(ttl)}
	return true, Record{}, nil
}

// Complete, kayit hala bu jetonla "isleniyor" ise bitirir.
func (m *Memory) Complete(_ context.Context, key, token string, done Record, ttl time.Duration) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.ownedBy(key, token) {
		return false, nil
	}
	m.records[key] = memoryEntry{record: done, expiresAt: m.now().Add(ttl)}
	return true, nil
}

// Release, kayit hala bu jetonla "isleniyor" ise siler.
func (m *Memory) Release(_ context.Context, key, token string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.ownedBy(key, token) {
		return false, nil
	}
	delete(m.records, key)
	return true, nil
}

// live, suresi dolmamis kayit; dolmussa siler.
func (m *Memory) live(key string) (Record, bool) {
	entry, found := m.records[key]
	if !found {
		return Record{}, false
	}
	if !m.now().Before(entry.expiresAt) {
		delete(m.records, key)
		return Record{}, false
	}
	return entry.record, true
}

// sweep, suresi dolan butun kayitlari siler (kilit altinda cagrilir).
func (m *Memory) sweep() {
	now := m.now()
	for key, entry := range m.records {
		if !now.Before(entry.expiresAt) {
			delete(m.records, key)
		}
	}
}

func (m *Memory) ownedBy(key, token string) bool {
	current, found := m.live(key)
	return found && current.State == StateInProgress && current.Token == token
}
