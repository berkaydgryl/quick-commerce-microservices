package emailverify

import (
	"context"
	"sync"
	"time"
)

// Memory, bellek deposu: MOCK=true ve testler icin. Kurallari Redis'tekiyle
// AYNIDIR (store_contract_test.go); gateway orneklerinin arasinda paylasilmaz,
// yalnizca tek ornekli gelistirme icindir (tekrar korumasiyla ayni kural).
type Memory struct {
	mu      sync.Mutex
	now     func() time.Time
	pending map[string]memoryRecord
}

type memoryRecord struct {
	email string
	// codeHash bossa kod kilitlidir (MaxAttempts yanlis).
	codeHash  string
	attempts  int
	sentAt    time.Time
	expiresAt time.Time
}

// NewMemory, verilen saatle bos depo kurar.
func NewMemory(now func() time.Time) *Memory {
	return &Memory{now: now, pending: map[string]memoryRecord{}}
}

// Start, yeni kodu yazar ya da kalan beklemeyi doner.
func (m *Memory) Start(_ context.Context, userID string, pending Pending, ttl, resendAfter time.Duration) (time.Duration, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	if record, found := m.live(userID, now); found {
		if wait := record.sentAt.Add(resendAfter).Sub(now); wait > 0 {
			return wait, nil
		}
	}
	m.pending[userID] = memoryRecord{email: pending.Email, codeHash: pending.CodeHash, sentAt: now, expiresAt: now.Add(ttl)}
	return 0, nil
}

// Check, kodu dener.
func (m *Memory) Check(_ context.Context, userID string, pending Pending, maxAttempts int) (Outcome, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	record, found := m.live(userID, m.now())
	switch {
	case !found || record.email != pending.Email:
		return Outcome{Result: ResultExpired}, nil
	case record.codeHash == "":
		return Outcome{Result: ResultLocked}, nil
	case record.codeHash == pending.CodeHash:
		delete(m.pending, userID)
		return Outcome{Result: ResultVerified}, nil
	}
	record.attempts++
	left := maxAttempts - record.attempts
	if left <= 0 {
		record.codeHash = ""
		m.pending[userID] = record
		return Outcome{Result: ResultLocked}, nil
	}
	m.pending[userID] = record
	return Outcome{Result: ResultWrong, AttemptsLeft: left}, nil
}

// Discard, ozet ayniysa kaydi siler.
func (m *Memory) Discard(_ context.Context, userID, codeHash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if record, found := m.pending[userID]; found && record.codeHash == codeHash {
		delete(m.pending, userID)
	}
	return nil
}

// live, suresi dolmamis kayit; dolmussa siler (Redis'te bu is TTL'dir).
func (m *Memory) live(userID string, now time.Time) (memoryRecord, bool) {
	record, found := m.pending[userID]
	if found && !now.Before(record.expiresAt) {
		delete(m.pending, userID)
		return memoryRecord{}, false
	}
	return record, found
}
