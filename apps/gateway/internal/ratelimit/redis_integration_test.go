//go:build integration

// Redis sayacinin entegrasyon testleri: GERCEK Redis'e (Testcontainers,
// redis:7-alpine) karsi, bellek sayaciyla AYNI sozlesmeden gecer. Saat gercek
// oldugu icin pencere kisadir (2 sn). Ek olarak: es zamanli isteklerde tam
// sinir kadar kabul, ayni Redis'i paylasan iki gateway orneginin ortak siniri
// (roadmap P2 kabul olcutu) ve sayacin bellek siniri.
//
// Calistirma (Docker gerekir): go test -tags integration ./internal/ratelimit/
package ratelimit

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/testcontainers/testcontainers-go"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/redisdb"
)

const redisImage = "redis:7-alpine"

// testWindow, gercek saatle sinanan pencere: bekleme paylari (en az 600 ms)
// kisitli CPU'da da yeter.
const testWindow = 2 * time.Second

var (
	redisURL string
	client   *redis.Client
)

// TestMain donunce test sarmalayicisi m.Run'in sonucuyla cikar.
func TestMain(m *testing.M) {
	if err := runWithRedis(m); err != nil {
		fmt.Fprintf(os.Stderr, "redis konteyneri: %v\n", err)
		os.Exit(1)
	}
}

func runWithRedis(m *testing.M) (err error) {
	ctx := context.Background()
	container, err := tcredis.Run(ctx, redisImage)
	if err != nil {
		return err
	}
	defer func() {
		if terminateErr := testcontainers.TerminateContainer(container); terminateErr != nil && err == nil {
			err = terminateErr
		}
	}()
	redisURL, err = container.ConnectionString(ctx)
	if err != nil {
		return err
	}
	client, err = connect(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := client.Close(); closeErr != nil && err == nil {
			err = closeErr
		}
	}()
	m.Run()
	return nil
}

func connect(ctx context.Context) (*redis.Client, error) {
	return redisdb.Connect(ctx, redisdb.Options{URL: redisURL, ConnectTimeout: 10 * time.Second, OperationTimeout: 5 * time.Second})
}

func TestRedisLimiterContract(t *testing.T) {
	limiterContract(t, func() Limiter { return NewRedis(client) }, testWindow, func(d time.Duration) { time.Sleep(d) })
}

func TestRedisConcurrentRequestsAdmitExactlyTheLimit(t *testing.T) {
	// Ayni anda 40 istek, sinir 10: betik atomik oldugu icin tam 10 kabul.
	// Ayni milisaniyedeki kayitlar birbirinin ustune yazmaz (uye eki).
	limiter := NewRedis(client)
	key := Key("10.1.0.1", "GET_/v1/yaris")
	var admitted atomic.Int32
	var wg sync.WaitGroup
	start := make(chan struct{})
	for range 40 {
		wg.Go(func() {
			<-start
			decision, err := limiter.Allow(context.Background(), key, 10, testWindow)
			if err != nil {
				t.Errorf("sayac hatasi: %v", err)
				return
			}
			if decision.Allowed {
				admitted.Add(1)
			}
		})
	}
	close(start)
	wg.Wait()

	if got := admitted.Load(); got != 10 {
		t.Errorf("tam 10 istek kabul edilmeli, %d kabul edildi", got)
	}
	if count := client.ZCard(context.Background(), key).Val(); count != 10 {
		t.Errorf("sayacta 10 kayit olmali: %d", count)
	}
}

func TestTwoGatewaysShareOneLimit(t *testing.T) {
	// P2: iki gateway ornegi (iki ayri baglanti) ayni Redis'e bagliyken sinir
	// ornek sayisindan bagimsiz tutar. Bellek sayacinda burada 8 istek gecerdi.
	other, err := connect(context.Background())
	if err != nil {
		t.Fatalf("ikinci baglanti kurulamadi: %v", err)
	}
	defer func() {
		if closeErr := other.Close(); closeErr != nil {
			t.Errorf("baglanti kapatilamadi: %v", closeErr)
		}
	}()
	first, second := NewRedis(client), NewRedis(other)
	key := Key("10.1.0.2", "POST_/v1/auth/login")

	admitted := 0
	for i := range 8 {
		limiter := first
		if i%2 == 1 {
			limiter = second
		}
		decision, err := limiter.Allow(context.Background(), key, 6, testWindow)
		if err != nil {
			t.Fatalf("sayac hatasi: %v", err)
		}
		if decision.Allowed {
			admitted++
		}
	}

	if admitted != 6 {
		t.Errorf("iki ornek birlikte 6 istek kabul etmeli, %d kabul etti", admitted)
	}
}

func TestStalledRedisIsBoundedByTheCallerDeadline(t *testing.T) {
	// Redis takilirsa (CLIENT PAUSE) sayac cagiranin kisa son tarihinde hata
	// doner; gateway istegi gecirir (fail-open). Surucu baglamin son tarihine
	// ancak ContextTimeoutEnabled ile uyar (redisdb.clientOptions).
	admin, err := connect(context.Background())
	if err != nil {
		t.Fatalf("yonetici baglantisi kurulamadi: %v", err)
	}
	defer func() {
		if err := admin.Do(context.Background(), "CLIENT", "UNPAUSE").Err(); err != nil {
			t.Errorf("Redis cozulemedi: %v", err)
		}
		if err := admin.Close(); err != nil {
			t.Errorf("baglanti kapatilamadi: %v", err)
		}
	}()
	// WRITE kipi betikleri (EVAL/EVALSHA) durdurur ama yonetici komutlarini
	// (UNPAUSE) gecirir; ALL kipi cozmeyi de bekletirdi.
	if err := admin.Do(context.Background(), "CLIENT", "PAUSE", "5000", "WRITE").Err(); err != nil {
		t.Fatalf("Redis dondurulamadi: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer cancel()
	startedAt := time.Now()
	_, err = NewRedis(client).Allow(ctx, Key("10.1.0.4", "GET_/v1/takilma"), 5, testWindow)

	if !errors.Is(err, ErrUnavailable) {
		t.Errorf("takilan Redis'te hata beklenirdi: %v", err)
	}
	if elapsed := time.Since(startedAt); elapsed > 2*time.Second {
		t.Errorf("son tarih uygulanmali (250 ms), %v surdu", elapsed)
	}
}

func TestRedisCounterStaysWithinLimitAndExpires(t *testing.T) {
	// Reddedilen istek yazilmaz: sayac sinirdan buyuk olamaz. Anahtar pencere
	// kadar yasar (TTL'siz Redis anahtari yok).
	limiter := NewRedis(client)
	key := Key("10.1.0.3", "GET_/v1/bellek")
	for range 23 {
		if _, err := limiter.Allow(context.Background(), key, 3, testWindow); err != nil {
			t.Fatalf("sayac hatasi: %v", err)
		}
	}

	if count := client.ZCard(context.Background(), key).Val(); count != 3 {
		t.Errorf("sayacta yalnizca 3 kabul edilen kayit olmali: %d", count)
	}
	if ttl := client.PTTL(context.Background(), key).Val(); ttl <= 0 || ttl > testWindow {
		t.Errorf("anahtar en fazla pencere kadar yasamali: %v", ttl)
	}
}

func TestRedisFailureCounterContract(t *testing.T) {
	failureCounterContract(t, func() FailureCounter { return NewRedis(client) }, testWindow, func(d time.Duration) { time.Sleep(d) })
}

func TestRedisFailureKeyExpiresWithItsWindow(t *testing.T) {
	// K2: basarisizlik sayacinin anahtari TTL'lidir (proje kurali): pencere kadar.
	ctx := context.Background()
	key := Key("usr_5123456789abcdef0123456789abcdef", "POST_/v1/me/cards/fail-1d")
	if err := NewRedis(client).Record(ctx, key, testWindow); err != nil {
		t.Fatalf("kayit: %v", err)
	}
	ttl, err := client.PTTL(ctx, key).Result()
	if err != nil {
		t.Fatalf("PTTL: %v", err)
	}
	if ttl <= 0 || ttl > testWindow {
		t.Errorf("anahtarin omru (0, pencere] olmali: %v", ttl)
	}
}

func TestRedisInflightContract(t *testing.T) {
	inflightContract(t, func() InflightLock { return NewRedis(client) }, testWindow, func(d time.Duration) { time.Sleep(d) })
}
