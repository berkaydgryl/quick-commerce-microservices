package geo

import (
	"testing"
	"time"
)

type fakeClock struct{ now time.Time }

func (c *fakeClock) Now() time.Time { return c.now }

func TestCacheExpiresEntries(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)}
	c := newCache[string](time.Minute, 10, clock.Now)
	c.put("a", "1")

	clock.now = clock.now.Add(59 * time.Second)
	if value, found := c.get("a"); !found || value != "1" {
		t.Errorf("suresi dolmamis kayit donmeli: %q %v", value, found)
	}
	clock.now = clock.now.Add(time.Second)
	if _, found := c.get("a"); found {
		t.Error("suresi dolan kayit donmemeli")
	}
	if c.order.Len() != 0 || len(c.entries) != 0 {
		t.Errorf("suresi dolan kayit silinmeli: %d %d", c.order.Len(), len(c.entries))
	}
}

func TestCacheEvictsLeastRecentlyUsed(t *testing.T) {
	clock := &fakeClock{now: time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)}
	c := newCache[string](time.Hour, 2, clock.Now)
	c.put("a", "1")
	c.put("b", "2")
	c.get("a") // a yeni kullanildi: cikan b olmali
	c.put("c", "3")

	if _, found := c.get("b"); found {
		t.Error("en uzun suredir kullanilmayan kayit cikmaliydi")
	}
	for _, key := range []string{"a", "c"} {
		if _, found := c.get(key); !found {
			t.Errorf("%s kalmaliydi", key)
		}
	}
	// Var olan anahtarin yeniden yazilmasi boyutu buyutmez.
	c.put("a", "1b")
	if value, _ := c.get("a"); value != "1b" || c.order.Len() != 2 {
		t.Errorf("kayit yenilenmeli, boyut 2 kalmali: %q %d", value, c.order.Len())
	}
}
