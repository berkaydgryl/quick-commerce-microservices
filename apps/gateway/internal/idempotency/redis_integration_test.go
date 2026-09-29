//go:build integration

// Redis deposunun entegrasyon testleri: GERCEK Redis'e (Testcontainers,
// redis:7-alpine - gelistirme ortamiyla ayni imaj) karsi, bellek deposuyla AYNI
// sozlesmeden gecer. Ek olarak es zamanli alma yarisi ve kayit omru sinanir.
//
// Calistirma (Docker gerekir): go test -tags integration ./internal/idempotency/
package idempotency

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/testcontainers/testcontainers-go"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/redisdb"
)

const redisImage = "redis:7-alpine"

var client *redis.Client

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
	url, err := container.ConnectionString(ctx)
	if err != nil {
		return err
	}
	client, err = redisdb.Connect(ctx, redisdb.Options{URL: url, ConnectTimeout: 10 * time.Second, OperationTimeout: 5 * time.Second})
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

func TestRedisStoreContract(t *testing.T) {
	// Redis'te saat ilerletilemez: omur testi gercekten bekler (1 sn'lik kayit).
	storeContract(t, func() Store {
		if err := client.FlushDB(context.Background()).Err(); err != nil {
			t.Fatalf("redis temizlenemedi: %v", err)
		}
		return NewRedis(client)
	}, func(d time.Duration) { time.Sleep(d) })
}

func TestRedisConcurrentClaimsHaveOneWinner(t *testing.T) {
	// B6: ayni anahtara ayni anda gelen 16 istekten yalnizca biri alir.
	store := NewRedis(client)
	key := Key("usr_1", "yaris-"+ids.New("k")[2:10])
	const racers = 16

	var wg sync.WaitGroup
	start := make(chan struct{})
	wins := make(chan bool, racers)
	for i := range racers {
		wg.Go(func() {
			<-start
			claimed, _, err := store.Claim(context.Background(), key, claimOf(fmt.Sprint(i)), time.Minute)
			if err != nil {
				t.Errorf("alma hatasi: %v", err)
			}
			wins <- claimed
		})
	}
	close(start)
	wg.Wait()
	close(wins)

	won := 0
	for claimed := range wins {
		if claimed {
			won++
		}
	}
	if won != 1 {
		t.Errorf("tam bir istek almali, %d aldi", won)
	}
}

func TestRedisRecordCarriesItsTTL(t *testing.T) {
	// Kaydin omru Redis'in kendi suresidir (PX): supurucu gerekmez.
	store := NewRedis(client)
	key := Key("usr_1", "omur-0001")
	if _, _, err := store.Claim(context.Background(), key, claimOf("a"), 30*time.Second); err != nil {
		t.Fatalf("alinamadi: %v", err)
	}
	if ttl := client.PTTL(context.Background(), key).Val(); ttl <= 25*time.Second || ttl > 30*time.Second {
		t.Errorf("isleniyor kaydi 30 sn yasamali: %v", ttl)
	}
	done := Record{State: StateDone, Fingerprint: "fp", Status: 201, Body: []byte(`{}`)}
	if written, err := store.Complete(context.Background(), key, "a", done, 2*time.Hour); err != nil || !written {
		t.Fatalf("bitirilemedi: %v %v", written, err)
	}
	if ttl := client.PTTL(context.Background(), key).Val(); ttl <= 2*time.Hour-time.Minute || ttl > 2*time.Hour {
		t.Errorf("bitmis kayit verilen omru almali: %v", ttl)
	}
}
