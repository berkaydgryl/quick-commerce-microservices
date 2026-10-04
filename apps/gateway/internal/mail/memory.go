package mail

import (
	"context"
	"slices"
	"sync"
)

// Memory, iletileri bellekte biriktiren gonderici: MOCK=true'da SMTP_URL
// verilmemisse ve testlerde (T11.14). Ileti hicbir yere yazilmaz (gunluk
// dahil): kod gunluge dusmesin. MOCK'ta kodu okumak isteyen Mailpit'i acip
// SMTP_URL verir.
type Memory struct {
	mu   sync.Mutex
	sent []Message
}

// NewMemory, bos kutu kurar.
func NewMemory() *Memory {
	return &Memory{}
}

// Send, iletiyi kutuya ekler.
func (m *Memory) Send(_ context.Context, msg Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, msg)
	return nil
}

// Sent, gonderilenler (kopya), gonderim sirasinda.
func (m *Memory) Sent() []Message {
	m.mu.Lock()
	defer m.mu.Unlock()
	return slices.Clone(m.sent)
}
