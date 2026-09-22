package clients

import "testing"

func TestNewPoolIsLazyAndIndexesByName(t *testing.T) {
	// grpc.NewClient tembeldir: dinleyen bir sunucu olmadan da havuz kurulmali.
	// Gateway, bagimli servis henuz ayakta degilken baslayabilmeli.
	pool, err := NewPool([]Target{
		{Name: "catalog", Address: "127.0.0.1:1"},
		{Name: "order", Address: "127.0.0.1:2"},
	})
	if err != nil {
		t.Fatalf("havuz kurulamadi: %v", err)
	}

	if _, ok := pool.Conn("catalog"); !ok {
		t.Error("catalog baglantisi bulunmaliydi")
	}
	if _, ok := pool.Conn("yok"); ok {
		t.Error("kayitsiz servis icin baglanti donmemeliydi")
	}

	if err := pool.Close(); err != nil {
		t.Errorf("kapanis hatasiz olmaliydi: %v", err)
	}
}
