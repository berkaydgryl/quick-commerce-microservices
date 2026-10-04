//go:build integration

// Redis deposunun entegrasyon testleri: GERCEK Redis'e (Testcontainers,
// redis:7-alpine) karsi, bellek deposuyla AYNI sozlesmeden gecer. Saat gercek
// oldugu icin sureler kisadir. Ek olarak: anahtarin bicimi ve omru (TTL'siz
// anahtar birakilmaz), kilitte omrun korunmasi ve beklenmeyen cevap.
//
// Calistirma (Docker gerekir): go test -tags integration ./internal/emailverify/
package emailverify

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/testcontainers/testcontainers-go"
	tcredis "github.com/testcontainers/testcontainers-go/modules/redis"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/redisdb"
)

const redisImage = "redis:7-alpine"

// Gercek saatle sinanan sureler: bekleme paylari kisitli CPU'da da yeter.
const (
	testTTL         = 2 * time.Second
	testResendAfter = 700 * time.Millisecond
	// testMargin, uykuya eklenen pay: Redis'in milisaniyelik suresi tam
	// sinirda dolmamis olabilir.
	testMargin = 150 * time.Millisecond
)

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
	runStoreContract(t, storeHarness{
		newStore:    func(*testing.T) Store { return NewRedis(client) },
		pass:        func(_ *testing.T, d time.Duration) { time.Sleep(d + testMargin) },
		ttl:         testTTL,
		resendAfter: testResendAfter,
		newUserID:   func() string { return ids.New(ids.User) },
	})
}

func TestRedisRecordIsOneHashWithTTL(t *testing.T) {
	store, user := NewRedis(client), ids.New(ids.User)
	if wait, err := store.Start(t.Context(), user, pendingA, CodeTTL, ResendAfter); err != nil || wait != 0 {
		t.Fatalf("kod yazilmaliydi: %v (%v)", wait, err)
	}
	key := "verify:email:{" + user + "}"

	ttl := client.PTTL(t.Context(), key).Val()
	if ttl <= CodeTTL-5*time.Second || ttl > CodeTTL {
		t.Errorf("omur 10 dk olmali: %v", ttl)
	}
	fields := client.HGetAll(t.Context(), key).Val()
	if fields["email"] != pendingA.Email || fields["codeHash"] != pendingA.CodeHash || fields["attempts"] != "0" || fields["sentAt"] == "" {
		t.Errorf("alanlar: %v", fields)
	}
}

func TestRedisWrongAttemptsAndLockKeepTheTTL(t *testing.T) {
	// Yanlis deneme ve kilit anahtarin omrune dokunmaz: kilitli kayit TTL'siz
	// kalsaydi kullanici bir daha kod isteyemezdi (sentAt hep dururdu).
	store, user := NewRedis(client), ids.New(ids.User)
	if wait, err := store.Start(t.Context(), user, pendingA, CodeTTL, ResendAfter); err != nil || wait != 0 {
		t.Fatalf("kod yazilmaliydi: %v (%v)", wait, err)
	}
	for range MaxAttempts {
		if _, err := store.Check(t.Context(), user, pendingB, MaxAttempts); err != nil {
			t.Fatalf("Check: %v", err)
		}
	}
	key := "verify:email:{" + user + "}"

	if ttl := client.PTTL(t.Context(), key).Val(); ttl <= 0 {
		t.Errorf("kilitli kaydin omru olmali: %v", ttl)
	}
	if client.HExists(t.Context(), key, "codeHash").Val() {
		t.Error("kilitte kodun ozeti silinmeli")
	}
}

func TestRedisCheckReportsUnreachableRedis(t *testing.T) {
	closed, err := redisdb.Connect(t.Context(), redisdb.Options{
		URL: "redis://" + client.Options().Addr, ConnectTimeout: 5 * time.Second, OperationTimeout: time.Second,
	})
	if err != nil {
		t.Fatalf("baglanti: %v", err)
	}
	if err := closed.Close(); err != nil {
		t.Fatalf("kapatma: %v", err)
	}

	_, err = NewRedis(closed).Check(t.Context(), ids.New(ids.User), pendingA, MaxAttempts)

	if err == nil {
		t.Fatal("kapali istemci hata vermeli")
	}
}
