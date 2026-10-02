package geo

import (
	"container/list"
	"sync"
	"time"
)

// cache, sureli ve boyutu sinirli onbellek: dolunca en uzun suredir
// kullanilmayan kayit cikar (LRU). Nominatim kosulu sonuclarin
// onbelleklenmesini ister; sinir bellegin buyumesini durdurur.
type cache[T any] struct {
	mu      sync.Mutex
	ttl     time.Duration
	size    int
	now     func() time.Time
	order   *list.List
	entries map[string]*list.Element
}

type cacheEntry[T any] struct {
	key     string
	value   T
	expires time.Time
}

func newCache[T any](ttl time.Duration, size int, now func() time.Time) *cache[T] {
	return &cache[T]{ttl: ttl, size: size, now: now, order: list.New(), entries: make(map[string]*list.Element, size)}
}

// get, suresi dolmamis kaydi doner; dolmussa siler.
func (c *cache[T]) get(key string) (T, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	element, found := c.entries[key]
	if !found {
		var zero T
		return zero, false
	}
	entry := element.Value.(*cacheEntry[T])
	if !c.now().Before(entry.expires) {
		c.order.Remove(element)
		delete(c.entries, key)
		var zero T
		return zero, false
	}
	c.order.MoveToFront(element)
	return entry.value, true
}

// put, kaydi yazar (varsa yeniler); sinir asilirsa en eskisini cikarir.
func (c *cache[T]) put(key string, value T) {
	c.mu.Lock()
	defer c.mu.Unlock()
	expires := c.now().Add(c.ttl)
	if element, found := c.entries[key]; found {
		entry := element.Value.(*cacheEntry[T])
		entry.value, entry.expires = value, expires
		c.order.MoveToFront(element)
		return
	}
	c.entries[key] = c.order.PushFront(&cacheEntry[T]{key: key, value: value, expires: expires})
	if c.order.Len() > c.size {
		oldest := c.order.Back()
		c.order.Remove(oldest)
		delete(c.entries, oldest.Value.(*cacheEntry[T]).key)
	}
}
