//go:build integration

// Goc duzeninin entegrasyon testleri: GERCEK Mongo'ya (Testcontainers, mongo:7)
// karsi. Calistirma (Docker gerekir): go test -tags integration ./internal/migrations/
package migrations

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	tcmongo "github.com/testcontainers/testcontainers-go/modules/mongodb"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mongodb"
)

var client *mongo.Client

func TestMain(m *testing.M) {
	if err := runWithMongo(m); err != nil {
		fmt.Fprintf(os.Stderr, "mongo konteyneri: %v\n", err)
		os.Exit(1)
	}
}

// runWithMongo, konteyneri baslatir, testleri kosar ve konteyneri HER DURUMDA kapatir.
func runWithMongo(m *testing.M) (err error) {
	ctx := context.Background()
	container, err := tcmongo.Run(ctx, "mongo:7")
	if err != nil {
		return err
	}
	defer func() {
		if terminateErr := testcontainers.TerminateContainer(container); terminateErr != nil && err == nil {
			err = terminateErr
		}
	}()
	uri, err := container.ConnectionString(ctx)
	if err != nil {
		return err
	}
	client, err = mongodb.Connect(ctx, mongodb.Options{URI: uri, ServerSelectionTimeout: 10 * time.Second, OperationTimeout: 10 * time.Second})
	if err != nil {
		return err
	}
	defer func() {
		if disconnectErr := client.Disconnect(ctx); disconnectErr != nil && err == nil {
			err = disconnectErr
		}
	}()
	m.Run()
	return nil
}

func testDatabase(t *testing.T) *mongo.Database {
	t.Helper()
	db := client.Database("migrations_" + ids.New("t"))
	t.Cleanup(func() {
		if err := db.Drop(context.Background()); err != nil {
			t.Errorf("veritabani silinemedi: %v", err)
		}
	})
	return db
}

func silentLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func newRunner(t *testing.T, db *mongo.Database, opts LockOptions) *Runner {
	t.Helper()
	runner, err := NewRunner(db, All(), silentLogger(), opts)
	if err != nil {
		t.Fatalf("calistirici kurulamadi: %v", err)
	}
	return runner
}

const keptID = "adr_0123456789abcdef0123456789abcdef"

// seedUsers, T11.15 oncesi bicimde kullanicilar: kimliksiz adresler, bir
// kimlikli adres (goc dokunmamali), adres alani hic olmayan ve bos defterli hesap.
func seedUsers(t *testing.T, db *mongo.Database) {
	t.Helper()
	address := func(title string) bson.D {
		return bson.D{{Key: "title", Value: title}, {Key: "kind", Value: "HOME"}, {Key: "line", Value: "Moda Cad. 12"},
			{Key: "location", Value: bson.D{{Key: "lat", Value: 40.98}, {Key: "lng", Value: 29.02}}}}
	}
	kept := append(bson.D{{Key: "id", Value: keptID}}, address("Yeni")...)
	documents := []any{
		bson.D{{Key: "_id", Value: "usr_a"}, {Key: "addresses", Value: bson.A{address("Ev"), kept, address("İş")}}},
		bson.D{{Key: "_id", Value: "usr_b"}, {Key: "addresses", Value: bson.A{address("Ev")}}},
		bson.D{{Key: "_id", Value: "usr_c"}},
		bson.D{{Key: "_id", Value: "usr_d"}, {Key: "addresses", Value: bson.A{}}},
	}
	if _, err := db.Collection("users").InsertMany(t.Context(), documents); err != nil {
		t.Fatalf("kullanicilar yazilamadi: %v", err)
	}
}

// addressIDsOf, kullanici basina adres kimlikleri (kimliksiz satir "").
func addressIDsOf(t *testing.T, db *mongo.Database) map[string][]string {
	t.Helper()
	cursor, err := db.Collection("users").Find(t.Context(), bson.D{})
	if err != nil {
		t.Fatalf("okuma: %v", err)
	}
	var users []struct {
		ID        string `bson:"_id"`
		Addresses []struct {
			ID string `bson:"id"`
		} `bson:"addresses"`
	}
	if err := cursor.All(t.Context(), &users); err != nil {
		t.Fatalf("cozme: %v", err)
	}
	result := map[string][]string{}
	for _, user := range users {
		result[user.ID] = []string{}
		for _, address := range user.Addresses {
			result[user.ID] = append(result[user.ID], address.ID)
		}
	}
	return result
}

func TestAddressIDsUpDownUp(t *testing.T) {
	db := testDatabase(t)
	seedUsers(t, db)
	runner := newRunner(t, db, LockOptions{})

	applied, err := runner.Up(t.Context())
	if err != nil || len(applied) != 1 || applied[0].Version != 1 || applied[0].Name != "adres-kimlikleri" {
		t.Fatalf("0001 uygulanmali: %+v %v", applied, err)
	}
	after := addressIDsOf(t, db)
	for user, list := range after {
		for _, id := range list {
			if !ids.Valid(ids.Address, id) {
				t.Errorf("%s: her adres adr_ kimligi almali: %v", user, list)
			}
		}
	}
	if after["usr_a"][1] != keptID || len(after["usr_a"]) != 3 || after["usr_a"][0] == after["usr_a"][2] {
		t.Errorf("kimlikli adrese dokunulmamali, kimlikler tekil olmali: %v", after["usr_a"])
	}
	if len(after["usr_c"]) != 0 || len(after["usr_d"]) != 0 {
		t.Errorf("adresi olmayan hesaplar degismemeli: %v", after)
	}

	// Ikinci up: bekleyen yok, kimlikler degismez.
	if again, err := runner.Up(t.Context()); err != nil || len(again) != 0 {
		t.Errorf("ikinci up bir sey uygulamamali: %+v %v", again, err)
	}
	if second := addressIDsOf(t, db); fmt.Sprint(second) != fmt.Sprint(after) {
		t.Errorf("ikinci up kimlikleri degistirmemeli:\n%v\n%v", after, second)
	}
	// Goc yeniden calistirilabilir: kayit olmadan kosulsa da bir sey yazmaz.
	if err := addAddressIDs(t.Context(), db); err != nil || fmt.Sprint(addressIDsOf(t, db)) != fmt.Sprint(after) {
		t.Errorf("tekrar kosu degisiklik yapmamali: %v", err)
	}

	record, found, err := runner.Down(t.Context())
	if err != nil || !found || record.Version != 1 {
		t.Fatalf("down 0001'i geri almali: %+v %v %v", record, found, err)
	}
	for user, list := range addressIDsOf(t, db) {
		for _, id := range list {
			if id != "" {
				t.Errorf("%s: down butun kimlikleri silmeli: %v", user, list)
			}
		}
	}
	if status, err := runner.Status(t.Context()); err != nil || len(status.Applied) != 0 || len(status.Pending) != 1 {
		t.Errorf("down kaydi silmeli: %+v %v", status, err)
	}

	if applied, err := runner.Up(t.Context()); err != nil || len(applied) != 1 {
		t.Fatalf("yeniden up uygulanmali: %+v %v", applied, err)
	}
	if again := addressIDsOf(t, db); len(again["usr_a"]) != 3 || !ids.Valid(ids.Address, again["usr_b"][0]) {
		t.Errorf("yeniden up kimlik vermeli: %v", again)
	}
}

func TestConcurrentStartsApplyTheMigrationOnce(t *testing.T) {
	db := testDatabase(t)
	seedUsers(t, db)

	const starts = 4
	var wg sync.WaitGroup
	results := make([][]Record, starts)
	errs := make([]error, starts)
	for i := range starts {
		runner := newRunner(t, db, LockOptions{Poll: 20 * time.Millisecond})
		wg.Go(func() { results[i], errs[i] = runner.Up(t.Context()) })
	}
	wg.Wait()

	total := 0
	for i := range starts {
		if errs[i] != nil {
			t.Errorf("%d. acilis hatasiz bitmeli: %v", i, errs[i])
		}
		total += len(results[i])
	}
	if total != 1 {
		t.Errorf("goc yalnizca bir kopyada uygulanmali, %d kez uygulandi", total)
	}
	count, err := db.Collection(RecordsCollection).CountDocuments(t.Context(), bson.D{})
	if err != nil || count != 1 {
		t.Errorf("tek kayit olmali: %d %v", count, err)
	}
	if locks, err := db.Collection(LockCollection).CountDocuments(t.Context(), bson.D{}); err != nil || locks != 0 {
		t.Errorf("kilit birakilmali: %d %v", locks, err)
	}
}

func TestInconsistentRecordsStopTheStart(t *testing.T) {
	db := testDatabase(t)
	seedUsers(t, db)
	if _, err := db.Collection(RecordsCollection).InsertOne(t.Context(), Record{Version: 1, Name: "baska-ad", AppliedAt: time.Now()}); err != nil {
		t.Fatalf("kayit yazilamadi: %v", err)
	}

	_, err := newRunner(t, db, LockOptions{}).Up(t.Context())

	if !errors.Is(err, ErrInconsistent) {
		t.Errorf("degistirilmis goc acilisi durdurmali: %v", err)
	}
	if after := addressIDsOf(t, db); after["usr_b"][0] != "" {
		t.Errorf("tutarsizlikta goc uygulanmamali: %v", after)
	}
}

func TestLockWaitsForTheOwnerAndTakesOverAStaleLock(t *testing.T) {
	db := testDatabase(t)
	var mu sync.Mutex
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	clock := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return now
	}
	advance := func(_ context.Context, d time.Duration) error {
		mu.Lock()
		defer mu.Unlock()
		now = now.Add(d)
		return nil
	}
	newTestLock := func(owner string, wait func(context.Context, time.Duration) error) *lock {
		created, err := newLock(db, silentLogger(), LockOptions{Owner: owner, TTL: time.Minute, Poll: time.Second, Now: clock, Sleep: wait})
		if err != nil {
			t.Fatalf("kilit: %v", err)
		}
		return created
	}
	owner := newTestLock("kopya-1", advance)
	if err := owner.acquire(t.Context()); err != nil {
		t.Fatalf("ilk kopya kilidi almali: %v", err)
	}

	// Sahip omru yeniledikce (uzun goc) bekleyen omur kadar bekleyip vazgecer.
	waiter := newTestLock("kopya-2", func(ctx context.Context, d time.Duration) error {
		if err := advance(ctx, d); err != nil {
			return err
		}
		return owner.renew(ctx)
	})
	if err := waiter.acquire(t.Context()); err == nil {
		t.Fatal("yenilenen kilit alinmamali; bekleyen omur kadar bekleyip hata vermeli")
	}

	// Sahip coktu (yenilemiyor): omru dolunca kilit devralinir.
	other := newTestLock("kopya-3", advance)
	if err := other.acquire(t.Context()); err != nil {
		t.Fatalf("omru dolan kilit devralinmali: %v", err)
	}
	if err := owner.renew(t.Context()); !errors.Is(err, ErrLockLost) {
		t.Errorf("kilidi kaybeden kopya durmali: %v", err)
	}
	// Eski sahibin birakmasi yeni sahibin kilidini silmez.
	owner.release(t.Context())
	if err := other.renew(t.Context()); err != nil {
		t.Errorf("yeni sahibin kilidi yerinde olmali: %v", err)
	}
	other.release(t.Context())
	if count, err := db.Collection(LockCollection).CountDocuments(t.Context(), bson.D{}); err != nil || count != 0 {
		t.Errorf("birakilan kilit silinmeli: %d %v", count, err)
	}
}
