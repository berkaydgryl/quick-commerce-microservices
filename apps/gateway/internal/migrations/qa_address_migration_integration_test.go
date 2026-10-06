//go:build integration

// QA kara kutu (T11.15 PR 1, #125; QA incelemesi Q1-Q4, Q6): gateway'in
// 0001 adres-kimlikleri gocu GERCEK Mongo'da (kendi konteyneri), yalnizca disa
// acik yoldan: migrations.Apply (acilisin prepareDatabase'i ayni cagriyi yapar),
// NewRunner, authstore ve HTTP uclari. Backend'in testleri gocu elle kurulmus
// belgelerle (up/down/up), kilidi sahte saatle sinar; burada:
//
//	Q1 T11.14 bicimli (kimliksiz) kullanicilar: acilis gocu kimlik verir; kimlik
//	   disindaki her alan, alan SIRASI dahil, birebir; ikinci acilis bir sey yazmaz.
//	Q2 Goc surerken eski surum bir kopya kimliksiz adres ekler: goc ya biter ya
//	   acik hatayla durur; kimlikler gecerli bicimde ve defter icinde tekil,
//	   satirlarin icerigi bozulmaz (kimlik rastgele oldugu icin "yanlis satira"
//	   yazim bu testle ayirt edilemez; satir filtresini backend testi sinar).
//	Q3 A1 (b), belgelenen davranis: goc kaydedildikten SONRA eklenen kimliksiz
//	   satir GET'te "id":"" doner ve yeniden acilis onu onarmaz.
//	Q4 Coken surecten kalan kilit: acilis kilidin omru dolana kadar bekler, sonra
//	   devralir ve uygular; beklerken iptal edilen acilis hicbir sey yazmaz.
//	Q6 Persona seed'i: seed -> acilis gocu bos gecer; seed tekrarinda kimlikler
//	   ayni; T11.14 verisinde gocun rastgele kimlikleri ilk seed'de bir kez degisir (A2).
//
// Calistirma (Docker gerekir): go test -tags integration -run TestQA ./internal/migrations/
package migrations_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/testcontainers/testcontainers-go"
	tcmongo "github.com/testcontainers/testcontainers-go/modules/mongodb"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"golang.org/x/crypto/bcrypt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/httpapi"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/migrations"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mongodb"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/persona"
)

var qaAddressIDPattern = regexp.MustCompile(`^adr_[0-9a-f]{32}$`)

func qaSilent() *slog.Logger { return slog.New(slog.NewJSONHandler(io.Discard, nil)) }

// qaDatabase, teste ozel Mongo konteyneri ve bos veritabani (indeks yok: acilis kurar).
func qaDatabase(t *testing.T) *mongo.Database {
	t.Helper()
	ctx := context.Background()
	container, err := tcmongo.Run(ctx, "mongo:7")
	if err != nil {
		t.Fatalf("mongo konteyneri: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(container); err != nil {
			t.Errorf("konteyner kapatilamadi: %v", err)
		}
	})
	uri, err := container.ConnectionString(ctx)
	if err != nil {
		t.Fatalf("baglanti dizesi: %v", err)
	}
	client, err := mongodb.Connect(ctx, mongodb.Options{URI: uri, ServerSelectionTimeout: 10 * time.Second, OperationTimeout: 10 * time.Second})
	if err != nil {
		t.Fatalf("mongo: %v", err)
	}
	t.Cleanup(func() {
		if err := client.Disconnect(context.Background()); err != nil {
			t.Errorf("mongo kapatilamadi: %v", err)
		}
	})
	return client.Database("qa_goc_" + ids.New("t"))
}

// qaStartup, gateway acilisinin veritabani adimi (cmd/gateway prepareDatabase ile ayni sira).
func qaStartup(t *testing.T, db *mongo.Database) error {
	t.Helper()
	if err := migrations.Apply(t.Context(), db, qaSilent()); err != nil {
		return err
	}
	return authstore.EnsureIndexes(t.Context(), db)
}

// qaT1114User, T11.14 bicimi: adreslerde kimlik yok (eski kod yazmazdi).
func qaT1114User(phone string, addresses []auth.SavedAddress) auth.User {
	return auth.User{
		ID: ids.New(ids.User), Phone: phone, PasswordHash: "$2a$04$ozet", FullName: "Ayşe Yılmaz",
		CreatedAt: time.Now().UTC().Truncate(time.Millisecond), Addresses: addresses,
	}
}

func qaAddress(title string, index int) auth.SavedAddress {
	return auth.SavedAddress{
		Title: title, Kind: "HOME", Line: fmt.Sprintf("Caferağa Mah. Moda Cad. No:%d, Kadıköy", index),
		Location: auth.GeoPoint{Lat: 40.98 + float64(index)/1000, Lng: 29.02},
		Building: "19C", Floor: "3", Apartment: fmt.Sprintf("%d", index), Note: "Zil çalışmıyor 🔔",
	}
}

// qaRawUsers, kullanici belgeleri SIRALI (bson.D) bicimde, kimlige gore.
func qaRawUsers(t *testing.T, db *mongo.Database) map[string]bson.D {
	t.Helper()
	cursor, err := db.Collection(authstore.UsersCollection).Find(t.Context(), bson.D{})
	if err != nil {
		t.Fatalf("okuma: %v", err)
	}
	var docs []bson.D
	if err := cursor.All(t.Context(), &docs); err != nil {
		t.Fatalf("cozme: %v", err)
	}
	result := map[string]bson.D{}
	for _, doc := range docs {
		for _, element := range doc {
			if element.Key == "_id" {
				result[fmt.Sprint(element.Value)] = doc
			}
		}
	}
	return result
}

// qaWithoutAddressIDs, belgenin adreslerinden yalnizca "id" alanini atar (sira korunur).
func qaWithoutAddressIDs(doc bson.D) (bson.D, []string) {
	var idsFound []string
	out := bson.D{}
	for _, element := range doc {
		if element.Key != "addresses" {
			out = append(out, element)
			continue
		}
		list, isList := element.Value.(bson.A)
		if !isList {
			out = append(out, element)
			continue
		}
		cleaned := bson.A{}
		for _, item := range list {
			address, _ := item.(bson.D)
			kept := bson.D{}
			for _, field := range address {
				if field.Key == "id" {
					idsFound = append(idsFound, fmt.Sprint(field.Value))
					continue
				}
				kept = append(kept, field)
			}
			cleaned = append(cleaned, kept)
		}
		out = append(out, bson.E{Key: "addresses", Value: cleaned})
	}
	return out, idsFound
}

func TestQAStartupMigrationGivesIDsAndKeepsEverythingElse(t *testing.T) {
	db := qaDatabase(t)
	// Karisik defter: T11.15 kodunun ekledigi (kimlikli) satir ve eski kopyanin kimliksiz satiri.
	kept := qaAddress("Yeni", 5)
	kept.ID = "adr_0123456789abcdef0123456789abcdef"
	users := []auth.User{
		qaT1114User("+905321200001", []auth.SavedAddress{qaAddress("Ev", 1), qaAddress("İş", 2), qaAddress("Yazlık", 3)}),
		qaT1114User("+905321200002", []auth.SavedAddress{qaAddress("Annemler", 4)}),
		qaT1114User("+905321200003", nil),
		qaT1114User("+905321200004", []auth.SavedAddress{kept, qaAddress("Eski", 6)}),
	}
	mixed := users[3].ID
	if err := authstore.EnsureIndexes(t.Context(), db); err != nil {
		t.Fatalf("indeksler: %v", err)
	}
	if err := authstore.ReplaceUsers(t.Context(), db, users); err != nil {
		t.Fatalf("T11.14 verisi yazilamadi: %v", err)
	}
	before := qaRawUsers(t, db)

	if err := qaStartup(t, db); err != nil {
		t.Fatalf("ilk acilis: %v", err)
	}
	after := qaRawUsers(t, db)
	if err := qaStartup(t, db); err != nil {
		t.Fatalf("ikinci acilis: %v", err)
	}
	again := qaRawUsers(t, db)

	for userID, original := range before {
		cleaned, found := qaWithoutAddressIDs(after[userID])
		cleanedBefore, _ := qaWithoutAddressIDs(original)
		if !reflect.DeepEqual(cleaned, cleanedBefore) {
			t.Errorf("%s: kimlik disindaki alanlar (ve sirasi) degismemeli:\nonce  %v\nsonra %v", userID, cleanedBefore, cleaned)
		}
		seen := map[string]bool{}
		for _, id := range found {
			if !qaAddressIDPattern.MatchString(id) || seen[id] {
				t.Errorf("%s: gecersiz ya da tekrar eden kimlik %q", userID, id)
			}
			seen[id] = true
		}
		_, originalIDs := qaWithoutAddressIDs(original)
		if userID == mixed {
			if len(found) != 2 || found[0] != kept.ID || len(originalIDs) != 1 {
				t.Errorf("kimlikli satira dokunulmamali, kimliksiz satir kimlik almali: once %v, sonra %v", originalIDs, found)
			}
			continue
		}
		if len(originalIDs) != 0 {
			t.Errorf("%s: T11.14 verisinde kimlik olmamali: %v", userID, originalIDs)
		}
	}
	if !reflect.DeepEqual(again, after) {
		t.Error("ikinci acilis hicbir belgeyi degistirmemeli")
	}
	records, err := db.Collection(migrations.RecordsCollection).CountDocuments(t.Context(), bson.D{})
	if err != nil || records != 1 {
		t.Errorf("tek goc kaydi olmali: %d %v", records, err)
	}
}

func TestQAMigrationWhileAnOldReplicaKeepsAddingAddresses(t *testing.T) {
	db := qaDatabase(t)
	if err := authstore.EnsureIndexes(t.Context(), db); err != nil {
		t.Fatalf("indeksler: %v", err)
	}
	const userCount = 150
	users := make([]auth.User, 0, userCount)
	for index := range userCount {
		users = append(users, qaT1114User(fmt.Sprintf("+90532130%04d", index), []auth.SavedAddress{qaAddress("Ev", index), qaAddress("İş", index)}))
	}
	if err := authstore.ReplaceUsers(t.Context(), db, users); err != nil {
		t.Fatalf("veri: %v", err)
	}

	// Eski surum kopya: kimliksiz satiri sona $push eder (T11.14 AddAddress).
	stop := make(chan struct{})
	var pushed atomic.Int64
	var writer sync.WaitGroup
	writer.Go(func() {
		for n := 0; ; n++ {
			select {
			case <-stop:
				return
			default:
			}
			user := users[rand.IntN(len(users))]
			address := bson.D{{Key: "title", Value: fmt.Sprintf("Eski-%d", n)}, {Key: "kind", Value: "OTHER"},
				{Key: "line", Value: fmt.Sprintf("Eski satir %d", n)}, {Key: "location", Value: bson.D{{Key: "lat", Value: 41.0}, {Key: "lng", Value: 29.0}}}}
			if _, err := db.Collection(authstore.UsersCollection).UpdateOne(context.Background(),
				bson.D{{Key: "_id", Value: user.ID}}, bson.D{{Key: "$push", Value: bson.D{{Key: "addresses", Value: address}}}}); err == nil {
				pushed.Add(1)
			}
		}
	})
	startupErr := migrations.Apply(t.Context(), db, qaSilent())
	close(stop)
	writer.Wait()

	if startupErr != nil && !strings.Contains(startupErr.Error(), "kimlik alamadi") {
		t.Fatalf("goc ya bitmeli ya da belgelenen hatayla durmali: %v", startupErr)
	}
	if pushed.Load() == 0 {
		t.Fatal("eski kopya goc sirasinda hic yazmadi; test yarisi kurmadi")
	}
	withoutID := 0
	for userID, doc := range qaRawUsers(t, db) {
		_, found := qaWithoutAddressIDs(doc)
		seen := map[string]bool{}
		for _, id := range found {
			if !qaAddressIDPattern.MatchString(id) || seen[id] {
				t.Errorf("%s: gecersiz ya da tekrar eden kimlik %q", userID, id)
			}
			seen[id] = true
		}
		var shaped struct {
			Addresses []struct {
				ID    string `bson:"id"`
				Title string `bson:"title"`
				Line  string `bson:"line"`
			} `bson:"addresses"`
		}
		raw, err := bson.Marshal(doc)
		if err != nil {
			t.Fatalf("kodlama: %v", err)
		}
		if err := bson.Unmarshal(raw, &shaped); err != nil {
			t.Fatalf("cozme: %v", err)
		}
		for _, address := range shaped.Addresses {
			if address.ID == "" {
				withoutID++
			}
			if strings.HasPrefix(address.Title, "Eski-") && address.Line != "Eski satir "+strings.TrimPrefix(address.Title, "Eski-") {
				t.Errorf("%s: satirin icerigi bozuldu: %+v", userID, address)
			}
		}
	}
	t.Logf("goc sirasinda eski kopyanin ekledigi satir: %d, gocten sonra kimliksiz kalan: %d, goc sonucu: %v (A1: belgelenen)",
		pushed.Load(), withoutID, startupErr)
}

// qaGateway, kimlik ve adres uclari Mongo depolariyla.
func qaGateway(t *testing.T, db *mongo.Database) *fiber.App {
	t.Helper()
	passwords, err := auth.NewPasswordHasher(bcrypt.MinCost)
	if err != nil {
		t.Fatalf("sifre ozetleyici: %v", err)
	}
	tokens := auth.NewTokens([]byte("yalnizca-qa-testi-icin-imza-sirri-32-bayttan-uzun"), time.Hour, time.Now)
	identity := auth.NewService(auth.Deps{
		Users: authstore.NewMongoUsers(db), Sessions: authstore.NewMongoSessions(db), Passwords: passwords,
		Tokens: tokens, RefreshTTL: 14 * 24 * time.Hour, Now: time.Now,
	})
	return httpapi.New(httpapi.Deps{
		UserRegistrar: identity, ProfileGetter: identity, AddressBook: identity, AddressAdder: identity,
		AddressUpdater: identity, AddressDeleter: identity, AccessTokens: tokens,
		Idempotency: httpapi.Idempotency{Store: idempotency.NewMemory(time.Now), FingerprintKey: []byte("qa-parmak-izi"), TTL: time.Hour},
		Logger:      qaSilent(),
	})
}

func qaCall(t *testing.T, app *fiber.App, method, path, access, body string) (int, []byte) {
	t.Helper()
	request := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	request.Header.Set(httpapi.IdempotencyKeyHeader, "qa-"+ids.New("k"))
	if access != "" {
		request.Header.Set(fiber.HeaderAuthorization, "Bearer "+access)
	}
	response, err := app.Test(request, fiber.TestConfig{Timeout: 30 * time.Second})
	if err != nil {
		t.Fatalf("istek: %v", err)
	}
	raw, readErr := io.ReadAll(response.Body)
	if closeErr := response.Body.Close(); closeErr != nil {
		t.Errorf("govde kapatilamadi: %v", closeErr)
	}
	if readErr != nil {
		t.Fatalf("govde okunamadi: %v", readErr)
	}
	return response.StatusCode, raw
}

func TestQAAddressWithoutIDAfterMigrationIsServedAsEmptyIDAndNotRepaired(t *testing.T) {
	db := qaDatabase(t)
	if err := qaStartup(t, db); err != nil {
		t.Fatalf("acilis: %v", err)
	}
	app := qaGateway(t, db)
	status, raw := qaCall(t, app, http.MethodPost, "/v1/auth/register", "",
		`{"phone":"+905321240001","password":"Gizli-Parola-2026","fullName":"Ayşe Yılmaz"}`)
	var registered struct {
		Data struct {
			AccessToken string `json:"accessToken"`
			User        struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"data"`
	}
	if status != http.StatusCreated || json.Unmarshal(raw, &registered) != nil {
		t.Fatalf("kayit: %d %s", status, raw)
	}
	access := registered.Data.AccessToken
	if status, raw := qaCall(t, app, http.MethodPost, "/v1/me/addresses", access,
		`{"title":"Ev","kind":"HOME","line":"Moda Cad. 12","location":{"lat":40.98,"lng":29.02}}`); status != http.StatusCreated {
		t.Fatalf("adres: %d %s", status, raw)
	}
	// Goc kaydedildikten SONRA eski surum bir kopya kimliksiz satir ekler.
	if _, err := db.Collection(authstore.UsersCollection).UpdateOne(t.Context(), bson.D{{Key: "_id", Value: registered.Data.User.ID}},
		bson.D{{Key: "$push", Value: bson.D{{Key: "addresses", Value: bson.D{{Key: "title", Value: "Eski"}, {Key: "kind", Value: "OTHER"},
			{Key: "line", Value: "Eski satir"}, {Key: "location", Value: bson.D{{Key: "lat", Value: 41.0}, {Key: "lng", Value: 29.0}}}}}}}}); err != nil {
		t.Fatalf("eski kopya yazimi: %v", err)
	}
	if err := qaStartup(t, db); err != nil {
		t.Fatalf("yeniden acilis: %v", err)
	}

	status, raw = qaCall(t, app, http.MethodGet, "/v1/me/addresses", access, "")
	var book struct {
		Data struct {
			Items []map[string]any `json:"items"`
		} `json:"data"`
	}
	if status != http.StatusOK || json.Unmarshal(raw, &book) != nil || len(book.Data.Items) != 2 {
		t.Fatalf("defter: %d %s", status, raw)
	}
	first, second := book.Data.Items[0], book.Data.Items[1]
	if id, _ := first["id"].(string); !qaAddressIDPattern.MatchString(id) {
		t.Errorf("gateway'in ekledigi adresin kimligi olmali: %v", first)
	}
	// A1 (b), belgelenen: kimliksiz satir "id":"" ile doner (web semasi bu listeyi reddeder),
	// yeniden acilis onarmaz (goc kayitli).
	if id, present := second["id"]; !present || id != "" {
		t.Errorf(`kimliksiz satir "id":"" ile donmeli (A1 belgelenen): %v`, second)
	}
	if status, _ := qaCall(t, app, http.MethodDelete, "/v1/me/addresses/adr_", access, ""); status != http.StatusNotFound {
		t.Errorf("kimliksiz satir hedeflenemez (404): %d", status)
	}
}

func TestQAStaleLockFromACrashedStartIsTakenOverAfterItsLifetime(t *testing.T) {
	db := qaDatabase(t)
	if err := authstore.EnsureIndexes(t.Context(), db); err != nil {
		t.Fatalf("indeksler: %v", err)
	}
	if err := authstore.ReplaceUsers(t.Context(), db, []auth.User{qaT1114User("+905321250001", []auth.SavedAddress{qaAddress("Ev", 1)})}); err != nil {
		t.Fatalf("veri: %v", err)
	}
	locks := db.Collection(migrations.LockCollection)
	staleUntil := time.Now().Add(2 * time.Second)
	// kill -9 ile olen kopyanin kilidi: sahibi yok, omru henuz dolmadi.
	if _, err := locks.InsertOne(t.Context(), bson.D{{Key: "_id", Value: "migrations"}, {Key: "owner", Value: "olmus-kopya"},
		{Key: "acquiredAt", Value: time.Now().Add(-8 * time.Second)}, {Key: "expiresAt", Value: staleUntil}}); err != nil {
		t.Fatalf("kilit: %v", err)
	}
	runner, err := migrations.NewRunner(db, migrations.All(), qaSilent(), migrations.LockOptions{TTL: 5 * time.Second, Poll: 100 * time.Millisecond})
	if err != nil {
		t.Fatalf("calistirici: %v", err)
	}

	// Beklerken iptal edilen acilis: hicbir sey yazmaz, kilidi almaz.
	canceled, cancel := context.WithTimeout(t.Context(), 500*time.Millisecond)
	_, canceledErr := runner.Up(canceled)
	cancel()
	owner := struct {
		Owner string `bson:"owner"`
	}{}
	if err := locks.FindOne(t.Context(), bson.D{}).Decode(&owner); err != nil {
		t.Fatalf("kilit okunamadi: %v", err)
	}
	records, err := db.Collection(migrations.RecordsCollection).CountDocuments(t.Context(), bson.D{})
	if err != nil {
		t.Fatalf("kayit sayilamadi: %v", err)
	}
	// Kilidi BEKLERKEN iptal: hata baglamin suresidir (baska bir hata degil).
	if !errors.Is(canceledErr, context.DeadlineExceeded) || owner.Owner != "olmus-kopya" || records != 0 {
		t.Fatalf("iptal edilen acilis yazmamali ve kilidi almamali: %v, sahip %q, kayit %d", canceledErr, owner.Owner, records)
	}

	startedAt := time.Now()
	applied, err := runner.Up(t.Context())
	waited := time.Since(startedAt)

	if err != nil || len(applied) != 1 {
		t.Fatalf("omru dolan kilit devralinip goc uygulanmali: %+v %v", applied, err)
	}
	if time.Now().Before(staleUntil) || waited > 10*time.Second {
		t.Errorf("kilidin omru dolana kadar beklemeli (bekleme %s)", waited)
	}
	if count, err := locks.CountDocuments(t.Context(), bson.D{}); err != nil || count != 0 {
		t.Errorf("kilit birakilmali: %d %v", count, err)
	}
	for userID, doc := range qaRawUsers(t, db) {
		if _, found := qaWithoutAddressIDs(doc); len(found) != 1 || !qaAddressIDPattern.MatchString(found[0]) {
			t.Errorf("%s: goc uygulanmali: %v", userID, found)
		}
	}
}

func TestQAPersonaSeedAndMigration(t *testing.T) {
	set, err := persona.Load()
	if err != nil {
		t.Fatalf("persona: %v", err)
	}
	seeded := set.Users(time.Now().UTC().Truncate(time.Millisecond), "$2a$04$ozet")
	idsByUser := func(t *testing.T, db *mongo.Database) map[string][]string {
		t.Helper()
		result := map[string][]string{}
		for userID, doc := range qaRawUsers(t, db) {
			_, found := qaWithoutAddressIDs(doc)
			result[userID] = found
		}
		return result
	}
	derived := map[string][]string{}
	for _, user := range seeded {
		for index := range user.Addresses {
			derived[user.ID] = append(derived[user.ID], persona.AddressID(user.ID, index))
		}
		if len(user.Addresses) == 0 {
			derived[user.ID] = nil
		}
	}

	t.Run("seed sonra acilis: goc bos gecer, kimlikler turetilmis; seed tekrari ayni kimlik", func(t *testing.T) {
		db := qaDatabase(t)
		if err := authstore.EnsureIndexes(t.Context(), db); err != nil {
			t.Fatalf("indeksler: %v", err)
		}
		if err := authstore.ReplaceUsers(t.Context(), db, seeded); err != nil {
			t.Fatalf("seed: %v", err)
		}
		afterSeed := idsByUser(t, db)
		if err := qaStartup(t, db); err != nil {
			t.Fatalf("acilis: %v", err)
		}
		if afterStartup := idsByUser(t, db); !reflect.DeepEqual(afterStartup, afterSeed) {
			t.Errorf("acilis gocu seed'in kimliklerine dokunmamali:\nseed   %v\nacilis %v", afterSeed, afterStartup)
		}
		if err := authstore.ReplaceUsers(t.Context(), db, set.Users(time.Now().UTC(), "$2a$04$ozet")); err != nil {
			t.Fatalf("ikinci seed: %v", err)
		}
		for userID, want := range derived {
			if !reflect.DeepEqual(afterSeed[userID], want) {
				t.Errorf("%s: seed turetilmis kimlik yazmali: %v, beklenen %v", userID, afterSeed[userID], want)
			}
		}
		if !reflect.DeepEqual(idsByUser(t, db), afterSeed) {
			t.Error("seed tekrarinda kimlikler ayni kalmali")
		}
	})

	t.Run("T11.14 verisi: goc rastgele kimlik verir, ilk seed turetilmise cevirir (A2, bir kez)", func(t *testing.T) {
		db := qaDatabase(t)
		if err := authstore.EnsureIndexes(t.Context(), db); err != nil {
			t.Fatalf("indeksler: %v", err)
		}
		old := make([]auth.User, 0, len(seeded))
		for _, user := range seeded {
			stripped := user
			stripped.Addresses = nil
			for _, address := range user.Addresses {
				address.ID = ""
				stripped.Addresses = append(stripped.Addresses, address)
			}
			old = append(old, stripped)
		}
		if err := authstore.ReplaceUsers(t.Context(), db, old); err != nil {
			t.Fatalf("T11.14 seed: %v", err)
		}
		if err := qaStartup(t, db); err != nil {
			t.Fatalf("acilis: %v", err)
		}
		migrated := idsByUser(t, db)
		if err := authstore.ReplaceUsers(t.Context(), db, seeded); err != nil {
			t.Fatalf("yeni seed: %v", err)
		}
		reseeded := idsByUser(t, db)

		changed := 0
		for userID, want := range derived {
			if !reflect.DeepEqual(reseeded[userID], want) {
				t.Errorf("%s: seed sonrasi turetilmis kimlik: %v", userID, reseeded[userID])
			}
			if len(want) > 0 && !reflect.DeepEqual(migrated[userID], want) {
				changed++
			}
		}
		if changed == 0 {
			t.Error("gocun verdigi rastgele kimlikler turetilmislerle ayni olmamali (A2 belgelenen)")
		}
	})
}
