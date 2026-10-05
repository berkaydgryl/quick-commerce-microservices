//go:build integration

// Mongo depolarinin entegrasyon testleri: GERCEK bir Mongo'ya (Testcontainers,
// mongo:7 - gelistirme ortamiyla ayni imaj) karsi kosar. Bellek depolari ayni
// kurallari taklit eder; buradaki testler taklidin dayandigi garantilerin
// (benzersiz indeks, atomik guncelleme, TTL indeksi) Mongo'da gercekten
// saglandigini gosterir.
//
// Calistirma (Docker gerekir): go test -tags integration ./internal/authstore/
package authstore_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	tcmongo "github.com/testcontainers/testcontainers-go/modules/mongodb"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"golang.org/x/crypto/bcrypt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/favorites"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mongodb"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/persona"
)

const (
	mongoImage = "mongo:7"
	// concurrency, yaris testlerinde ayni anda gelen istek sayisi.
	concurrency = 16
)

// client, butun testlerin paylastigi baglanti; her test kendi veritabanini
// acar (testDatabase), boylece testler birbirinin kaydini gormez.
var client *mongo.Client

// TestMain donunce test sarmalayicisi m.Run'in sonucuyla cikar; burada
// yalnizca konteyner kurulamazsa cikis kodu verilir.
func TestMain(m *testing.M) {
	if err := runWithMongo(m); err != nil {
		fmt.Fprintf(os.Stderr, "mongo konteyneri: %v\n", err)
		os.Exit(1)
	}
}

// runWithMongo, konteyneri baslatir, testleri kosar ve konteyneri HER DURUMDA
// kapatir (os.Exit'le cikilsaydi defer calismazdi; bu yuzden ayri fonksiyon).
func runWithMongo(m *testing.M) (err error) {
	ctx := context.Background()
	container, err := tcmongo.Run(ctx, mongoImage)
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

// testDatabase, teste ozel, indeksleri kurulu bos veritabani.
func testDatabase(t *testing.T) *mongo.Database {
	t.Helper()
	db := client.Database("authstore_" + ids.New("t"))
	if err := authstore.EnsureIndexes(t.Context(), db); err != nil {
		t.Fatalf("indeksler kurulamadi: %v", err)
	}
	t.Cleanup(func() {
		if err := db.Drop(context.Background()); err != nil {
			t.Errorf("veritabani silinemedi: %v", err)
		}
	})
	return db
}

func newUser(phone string) auth.User {
	return auth.User{
		ID: ids.New(ids.User), Phone: phone, PasswordHash: "$2a$04$ozet", FullName: "Ayse Yilmaz",
		CreatedAt: time.Now().UTC().Truncate(time.Millisecond),
	}
}

func newSession(userID, tokenHash string, expiresAt time.Time) auth.Session {
	now := time.Now().UTC().Truncate(time.Millisecond)
	return auth.Session{
		ID: ids.New(ids.Session), UserID: userID, TokenHash: tokenHash,
		CreatedAt: now, RefreshedAt: now, ExpiresAt: expiresAt.UTC().Truncate(time.Millisecond), IPAddress: "203.0.113.7",
	}
}

func TestUsersRoundTripAndUniquePhone(t *testing.T) {
	users := authstore.NewMongoUsers(testDatabase(t))
	user := newUser("+905321234567")
	if err := users.Create(t.Context(), user); err != nil {
		t.Fatalf("kullanici yazilamadi: %v", err)
	}

	byPhone, err := users.ByPhone(t.Context(), user.Phone)
	if err != nil || !byPhone.CreatedAt.Equal(user.CreatedAt) || byPhone.ID != user.ID || byPhone.PasswordHash != user.PasswordHash {
		t.Errorf("telefonla okunan kayit yazilanla ayni olmali: %+v %v", byPhone, err)
	}
	if byID, err := users.ByID(t.Context(), user.ID); err != nil || byID.Phone != user.Phone {
		t.Errorf("kimlikle okunamadi: %+v %v", byID, err)
	}
	if _, err := users.ByPhone(t.Context(), "+905559876543"); !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("olmayan kullanici ErrUserNotFound donmeli: %v", err)
	}
	if err := users.Create(t.Context(), newUser(user.Phone)); !errors.Is(err, auth.ErrPhoneTaken) {
		t.Errorf("ayni telefon ErrPhoneTaken donmeli: %v", err)
	}
}

func TestConcurrentRegistrationsOfOnePhoneCreateOneUser(t *testing.T) {
	// "Once bak, sonra yaz" bu yarista iki hesap acardi; karar benzersiz indekste.
	db := testDatabase(t)
	users := authstore.NewMongoUsers(db)

	errs := race(func() error { return users.Create(t.Context(), newUser("+905321234567")) })

	created, taken := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			created++
		case errors.Is(err, auth.ErrPhoneTaken):
			taken++
		default:
			t.Errorf("beklenmeyen hata: %v", err)
		}
	}
	count, err := db.Collection(authstore.UsersCollection).CountDocuments(t.Context(), bson.D{})
	if created != 1 || taken != concurrency-1 || err != nil || count != 1 {
		t.Errorf("tek hesap acilmali: acilan %d, reddedilen %d, kayit %d (%v)", created, taken, count, err)
	}
}

func TestConcurrentRotationsOfOneTokenSucceedOnce(t *testing.T) {
	// Calinan jetonla sahibi ayni anda yenilerse yalnizca biri kazanir.
	sessions := authstore.NewMongoSessions(testDatabase(t))
	if err := sessions.Create(t.Context(), newSession(ids.New(ids.User), "eski-ozet", time.Now().Add(time.Hour))); err != nil {
		t.Fatalf("oturum yazilamadi: %v", err)
	}

	errs := race(func() error {
		now := time.Now()
		_, err := sessions.Rotate(t.Context(), "eski-ozet", ids.New("ozet"), now, now.Add(time.Hour))
		return err
	})

	rotated := 0
	for _, err := range errs {
		switch {
		case err == nil:
			rotated++
		case !errors.Is(err, auth.ErrSessionNotFound):
			t.Errorf("kaybeden ErrSessionNotFound almali: %v", err)
		}
	}
	if rotated != 1 {
		t.Errorf("tam bir yenileme basarmali, %d basardi", rotated)
	}
}

func TestRotateReturnsUpdatedSession(t *testing.T) {
	sessions := authstore.NewMongoSessions(testDatabase(t))
	original := newSession(ids.New(ids.User), "eski-ozet", time.Now().Add(time.Hour))
	if err := sessions.Create(t.Context(), original); err != nil {
		t.Fatalf("oturum yazilamadi: %v", err)
	}
	now := time.Now().UTC().Truncate(time.Millisecond)

	rotated, err := sessions.Rotate(t.Context(), "eski-ozet", "yeni-ozet", now, now.Add(2*time.Hour))

	if err != nil || rotated.ID != original.ID || rotated.UserID != original.UserID || rotated.TokenHash != "yeni-ozet" ||
		!rotated.RefreshedAt.Equal(now) || !rotated.ExpiresAt.Equal(now.Add(2*time.Hour)) || !rotated.CreatedAt.Equal(original.CreatedAt) {
		t.Errorf("guncel oturum donmeli: %+v %v", rotated, err)
	}
}

func TestExpiredSessionIsNotRotatedBeforeTTLCleanup(t *testing.T) {
	// TTL gorevi dakikada bir calisir; suresi dolan kayit silinmeden once de
	// yenilenmemeli.
	sessions := authstore.NewMongoSessions(testDatabase(t))
	expiresAt := time.Now().Add(time.Hour)
	if err := sessions.Create(t.Context(), newSession(ids.New(ids.User), "eski-ozet", expiresAt)); err != nil {
		t.Fatalf("oturum yazilamadi: %v", err)
	}

	later := expiresAt.Add(time.Second)
	if _, err := sessions.Rotate(t.Context(), "eski-ozet", "yeni-ozet", later, later.Add(time.Hour)); !errors.Is(err, auth.ErrSessionNotFound) {
		t.Errorf("suresi dolan oturum ErrSessionNotFound donmeli: %v", err)
	}
}

func TestRevokeDeletesOnce(t *testing.T) {
	sessions := authstore.NewMongoSessions(testDatabase(t))
	if err := sessions.Create(t.Context(), newSession(ids.New(ids.User), "ozet", time.Now().Add(time.Hour))); err != nil {
		t.Fatalf("oturum yazilamadi: %v", err)
	}

	for attempt, want := range []bool{true, false} {
		if revoked, err := sessions.Revoke(t.Context(), "ozet"); err != nil || revoked != want {
			t.Errorf("%d. iptal: %v bekleniyordu, %v geldi (%v)", attempt+1, want, revoked, err)
		}
	}
}

func TestIndexesAreDeclaredAndIdempotent(t *testing.T) {
	db := testDatabase(t)
	if err := authstore.EnsureIndexes(t.Context(), db); err != nil {
		t.Fatalf("ikinci kurulum hata vermemeli: %v", err)
	}

	users := indexesOf(t, db.Collection(authstore.UsersCollection))
	sessions := indexesOf(t, db.Collection(authstore.SessionsCollection))

	if index, found := users["phone_unique"]; !found || index["unique"] != true {
		t.Errorf("users.phone benzersiz olmali: %v", users)
	}
	if index, found := sessions["tokenHash_unique"]; !found || index["unique"] != true {
		t.Errorf("sessions.tokenHash benzersiz olmali: %v", sessions)
	}
	if index, found := sessions["expiresAt_ttl"]; !found || !isZero(index["expireAfterSeconds"]) {
		t.Errorf("sessions.expiresAt TTL indeksi (0 sn) olmali: %v", sessions)
	}
	if _, found := sessions["userId"]; !found {
		t.Errorf("sessions.userId indeksi olmali: %v", sessions)
	}
	if index, found := users["registrationDeviceId"]; !found || index["sparse"] != true {
		t.Errorf("users.registrationDeviceId seyrek indeksi olmali: %v", users)
	}
	if index, found := users["email_unique"]; !found || index["unique"] != true || index["partialFilterExpression"] == nil {
		t.Errorf("users.email kismi benzersiz olmali (T11.14): %v", users)
	}
}

func TestServiceFlowOnMongo(t *testing.T) {
	// Servis Mongo depolariyla: kayit -> ayni numarayla ikinci kayit -> giris
	// -> yenileme (eski jeton reddedilir) -> cikis.
	db := testDatabase(t)
	hasher, err := auth.NewPasswordHasher(bcrypt.MinCost)
	if err != nil {
		t.Fatalf("ozetleyici kurulamadi: %v", err)
	}
	service := auth.NewService(auth.Deps{
		Users: authstore.NewMongoUsers(db), Sessions: authstore.NewMongoSessions(db), Passwords: hasher,
		Tokens:     auth.NewTokens([]byte("yalnizca-test-icin-imza-sirri-32-bayttan-uzun"), time.Hour, time.Now),
		RefreshTTL: 14 * 24 * time.Hour, Now: time.Now,
	})
	input := auth.RegisterInput{Phone: "+905321234567", Password: "Gizli-Parola-2026", FullName: "Ayse Yilmaz"}

	registered, err := service.Register(t.Context(), input, auth.RequestMeta{IPAddress: "203.0.113.7"})
	if err != nil {
		t.Fatalf("kayit basarisiz: %v", err)
	}
	if _, err := service.Register(t.Context(), input, auth.RequestMeta{}); err == nil {
		t.Error("ayni numarayla ikinci kayit reddedilmeliydi")
	}
	loggedIn, err := service.Login(t.Context(), auth.LoginInput{Phone: input.Phone, Password: input.Password}, auth.RequestMeta{})
	if err != nil || loggedIn.User != registered.User {
		t.Fatalf("giris basarisiz: %+v %v", loggedIn, err)
	}
	refreshed, err := service.Refresh(t.Context(), loggedIn.RefreshToken)
	if err != nil {
		t.Fatalf("yenileme basarisiz: %v", err)
	}
	if _, err := service.Refresh(t.Context(), loggedIn.RefreshToken); err == nil {
		t.Error("kullanilmis jeton reddedilmeliydi")
	}
	if revoked, err := service.Logout(t.Context(), refreshed.RefreshToken); err != nil || !revoked {
		t.Errorf("cikis iptal etmeli: %v %v", revoked, err)
	}

	// Saklanan kayitlarda ham jeton ve ham sifre yok.
	var stored bson.M
	if err := db.Collection(authstore.SessionsCollection).FindOne(t.Context(), bson.D{}).Decode(&stored); err != nil {
		t.Fatalf("kalan oturum okunamadi: %v", err)
	}
	if stored["tokenHash"] == registered.RefreshToken || stored["tokenHash"] != auth.HashRefreshToken(registered.RefreshToken) {
		t.Errorf("oturum jetonun ozetiyle saklanmali: %v", stored)
	}
}

// race, fn'i concurrency kez AYNI ANDA calistirir ve hatalari toplar.
func race(fn func() error) []error {
	start := make(chan struct{})
	errs := make([]error, concurrency)
	var wg sync.WaitGroup
	for i := range concurrency {
		wg.Go(func() {
			<-start
			errs[i] = fn()
		})
	}
	close(start)
	wg.Wait()
	return errs
}

// indexesOf, koleksiyonun indekslerini ada gore doner.
func indexesOf(t *testing.T, collection *mongo.Collection) map[string]bson.M {
	t.Helper()
	cursor, err := collection.Indexes().List(t.Context())
	if err != nil {
		t.Fatalf("indeksler listelenemedi: %v", err)
	}
	var list []bson.M
	if err := cursor.All(t.Context(), &list); err != nil {
		t.Fatalf("indeksler okunamadi: %v", err)
	}
	byName := make(map[string]bson.M, len(list))
	for _, index := range list {
		if name, isString := index["name"].(string); isString {
			byName[name] = index
		}
	}
	return byName
}

// isZero, Mongo'nun sayiyi hangi tiple dondurdugunden bagimsiz sifir denetimi.
func isZero(value any) bool {
	switch number := value.(type) {
	case int32:
		return number == 0
	case int64:
		return number == 0
	case float64:
		return number == 0
	default:
		return false
	}
}

func TestUserSignalFieldsRoundTrip(t *testing.T) {
	users := authstore.NewMongoUsers(testDatabase(t))
	user := newUser("+905321234567")
	user.RegistrationDeviceID = ids.New(ids.Device)
	user.LastLoginIP = "85.105.1.1"
	user.LastLocation = &auth.GeoPoint{Lat: 39.93, Lng: 32.86}
	user.Addresses = []auth.SavedAddress{{Title: "Ev", Line: "Moda Cad. 12", Location: auth.GeoPoint{Lat: 40.98, Lng: 29.02}, Note: "zil calismiyor"}}
	if err := users.Create(t.Context(), user); err != nil {
		t.Fatalf("kullanici yazilamadi: %v", err)
	}

	got, err := users.ByID(t.Context(), user.ID)

	if err != nil || got.RegistrationDeviceID != user.RegistrationDeviceID || got.LastLoginIP != user.LastLoginIP ||
		got.LastLocation == nil || *got.LastLocation != *user.LastLocation || len(got.Addresses) != 1 || got.Addresses[0] != user.Addresses[0] {
		t.Errorf("sinyal alanlari ve adresler aynen donmeli: %+v %v", got, err)
	}
}

func TestRecordLoginReturnsPreviousStateAtomically(t *testing.T) {
	users := authstore.NewMongoUsers(testDatabase(t))
	user := newUser("+905321234567")
	user.LastLoginIP = "85.105.1.1"
	user.LastLocation = &auth.GeoPoint{Lat: 39.93, Lng: 32.86}
	if err := users.Create(t.Context(), user); err != nil {
		t.Fatalf("kullanici yazilamadi: %v", err)
	}

	// Konum bilinmiyor: yalnizca IP guncellenir, son konum korunur.
	previous, err := users.RecordLogin(t.Context(), user.ID, auth.LoginState{IPAddress: "85.105.1.2"})
	if err != nil || previous.IPAddress != "85.105.1.1" || previous.Location == nil || *previous.Location != *user.LastLocation {
		t.Fatalf("onceki durum donmeli: %+v %v", previous, err)
	}
	after, err := users.ByID(t.Context(), user.ID)
	if err != nil || after.LastLoginIP != "85.105.1.2" || after.LastLocation == nil || *after.LastLocation != *user.LastLocation {
		t.Errorf("IP guncellenmeli, konum korunmali: %+v %v", after, err)
	}

	// Es zamanli girislerde her giris FARKLI bir onceki IP gorur: once okuyup
	// sonra yazan bir uygulamada iki giris ayni onceki degeri gorurdu.
	var mu sync.Mutex
	seen := map[string]int{}
	errs := race(func() error {
		previous, err := users.RecordLogin(t.Context(), user.ID, auth.LoginState{IPAddress: ids.New("ip")})
		mu.Lock()
		seen[previous.IPAddress]++
		mu.Unlock()
		return err
	})
	for _, err := range errs {
		if err != nil {
			t.Errorf("es zamanli giris hatasi: %v", err)
		}
	}
	if len(seen) != concurrency {
		t.Errorf("%d giris %d farkli onceki IP gormeli, %d gordu: %v", concurrency, concurrency, len(seen), seen)
	}
	if _, err := users.RecordLogin(t.Context(), ids.New(ids.User), auth.LoginState{IPAddress: "1.1.1.1"}); !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("olmayan kullanici ErrUserNotFound donmeli: %v", err)
	}
}

func TestCountByRegistrationDevice(t *testing.T) {
	users := authstore.NewMongoUsers(testDatabase(t))
	shared := ids.New(ids.Device)
	for i, device := range []string{shared, shared, shared, ids.New(ids.Device), ""} {
		user := newUser("+90532123456" + string(rune('0'+i)))
		user.RegistrationDeviceID = device
		if err := users.Create(t.Context(), user); err != nil {
			t.Fatalf("kullanici yazilamadi: %v", err)
		}
	}

	count, err := users.CountByRegistrationDevice(t.Context(), shared)

	if err != nil || count != 3 {
		t.Errorf("ortak cihazdan 3 hesap sayilmali: %d %v", count, err)
	}
}

func TestSessionSignalFieldsAndByID(t *testing.T) {
	sessions := authstore.NewMongoSessions(testDatabase(t))
	session := newSession(ids.New(ids.User), "ozet", time.Now().Add(time.Hour))
	session.DeviceID = ids.New(ids.Device)
	session.PreviousIPAddress = "85.105.1.1"
	session.IPCity = "Ankara"
	session.Location = &auth.GeoPoint{Lat: 39.93, Lng: 32.86}
	if err := sessions.Create(t.Context(), session); err != nil {
		t.Fatalf("oturum yazilamadi: %v", err)
	}
	now := time.Now()
	if _, err := sessions.Rotate(t.Context(), "ozet", "yeni-ozet", now, now.Add(time.Hour)); err != nil {
		t.Fatalf("yenileme basarisiz: %v", err)
	}

	got, err := sessions.ByID(t.Context(), session.ID)

	// Yenileme yalnizca jeton alanlarina dokunur; sinyaller oturumla yasar.
	if err != nil || got.DeviceID != session.DeviceID || got.PreviousIPAddress != "85.105.1.1" || got.IPCity != "Ankara" ||
		got.Location == nil || *got.Location != *session.Location || got.TokenHash != "yeni-ozet" {
		t.Errorf("sinyal alanlari yenilemeden sonra da okunmali: %+v %v", got, err)
	}
	if _, err := sessions.ByID(t.Context(), ids.New(ids.Session)); !errors.Is(err, auth.ErrSessionNotFound) {
		t.Errorf("olmayan oturum ErrSessionNotFound donmeli: %v", err)
	}
}

func TestReplaceUsersIsRepeatableAndClearsOldSessions(t *testing.T) {
	db := testDatabase(t)
	users, sessions := authstore.NewMongoUsers(db), authstore.NewMongoSessions(db)
	persona := newUser("+905550000001")
	// Ayni demo numarasiyla elle acilmis bir hesap ve oturumu: seed ikisini de temizler.
	squatter := newUser(persona.Phone)
	if err := users.Create(t.Context(), squatter); err != nil {
		t.Fatalf("hesap yazilamadi: %v", err)
	}
	if err := sessions.Create(t.Context(), newSession(squatter.ID, "elle-ozet", time.Now().Add(time.Hour))); err != nil {
		t.Fatalf("oturum yazilamadi: %v", err)
	}

	for run := 1; run <= 2; run++ {
		if err := authstore.ReplaceUsers(t.Context(), db, []auth.User{persona}); err != nil {
			t.Fatalf("%d. seed basarisiz: %v", run, err)
		}
	}

	count, err := db.Collection(authstore.UsersCollection).CountDocuments(t.Context(), bson.D{})
	if err != nil || count != 1 {
		t.Errorf("iki calismadan sonra tek hesap kalmali: %d %v", count, err)
	}
	if got, err := users.ByPhone(t.Context(), persona.Phone); err != nil || got.ID != persona.ID {
		t.Errorf("numara personaya ait olmali: %+v %v", got, err)
	}
	if left, err := db.Collection(authstore.SessionsCollection).CountDocuments(t.Context(), bson.D{}); err != nil || left != 0 {
		t.Errorf("silinen hesabin oturumu da silinmeli: %d %v", left, err)
	}
}

func TestAddressBookOnMongoFollowsThePersonaSeed(t *testing.T) {
	// GET /v1/me/addresses'in Mongo yolu: persona seed'i (ReplaceUsers) ile
	// yazilan uc hazir adres, servisten kayit sirasinda ve sozlesme bicimiyle doner.
	db := testDatabase(t)
	set, err := persona.Load()
	if err != nil {
		t.Fatalf("persona dosyasi gecersiz: %v", err)
	}
	seeded := set.Users(time.Now(), "$2a$04$ozet")
	if err := authstore.ReplaceUsers(t.Context(), db, seeded); err != nil {
		t.Fatalf("seed basarisiz: %v", err)
	}
	service := auth.NewService(auth.Deps{
		Users: authstore.NewMongoUsers(db), Sessions: authstore.NewMongoSessions(db),
		Tokens: auth.NewTokens([]byte("yalnizca-test-icin-imza-sirri-32-bayttan-uzun"), time.Hour, time.Now),
		Now:    time.Now,
	})

	book, err := service.Addresses(t.Context(), seeded[0].ID)
	if err != nil {
		t.Fatalf("adres defteri okunamadi: %v", err)
	}

	titles := make([]string, 0, len(book.Items))
	for _, entry := range book.Items {
		titles = append(titles, entry.Title)
	}
	if strings.Join(titles, ",") != "Ev,İş,Yazlık" {
		t.Errorf("hazir adresler seed sirasinda donmeli: %v", titles)
	}
	if first := book.Items[0]; first.Location.Lat != 40.9885 || first.Location.Lng != 29.0262 || first.Line == "" {
		t.Errorf("konum ve adres satiri Mongo'dan aynen donmeli: %+v", first)
	}
	// T11.15: seed kimligi yazar; her seed'de ayni (tarayicidaki secim korunur).
	for i, entry := range book.Items {
		if entry.ID != persona.AddressID(seeded[0].ID, i) {
			t.Errorf("%d. hazir adresin kimligi seed'deki gibi olmali: %q", i, entry.ID)
		}
	}
}

func savedAddress(title string) auth.SavedAddress {
	return auth.SavedAddress{
		Title: title, Kind: auth.AddressKindHome, Line: "Acıbadem, 34660 Üsküdar/İstanbul, Türkiye",
		Location: auth.GeoPoint{Lat: 40.9885, Lng: 29.027}, Building: "19C3", Floor: "3", Apartment: "12", Note: "Zil bozuk",
	}
}

func TestAddAddressRoundTripAndRules(t *testing.T) {
	users := authstore.NewMongoUsers(testDatabase(t))
	user := newUser("+905321234567")
	if err := users.Create(t.Context(), user); err != nil {
		t.Fatalf("kullanici yazilamadi: %v", err)
	}

	// Adres alani hic yazilmamis hesap ($ifNull): ilk adres eklenir.
	added, err := users.AddAddress(t.Context(), user.ID, savedAddress("Ev"), auth.MaxSavedAddresses)
	if err != nil || len(added.Addresses) != 1 || added.Addresses[0] != savedAddress("Ev") {
		t.Fatalf("eklenen adres butun alanlariyla donmeli: %+v %v", added.Addresses, err)
	}
	if read, err := users.ByID(t.Context(), user.ID); err != nil || len(read.Addresses) != 1 || read.Addresses[0] != savedAddress("Ev") {
		t.Errorf("okunan defter eklenenle ayni olmali: %+v %v", read.Addresses, err)
	}

	if _, err := users.AddAddress(t.Context(), user.ID, savedAddress("Ev"), auth.MaxSavedAddresses); !errors.Is(err, auth.ErrAddressTitleTaken) {
		t.Errorf("ayni ad ErrAddressTitleTaken donmeli: %v", err)
	}
	for i := 1; i < auth.MaxSavedAddresses; i++ {
		if _, err := users.AddAddress(t.Context(), user.ID, savedAddress(fmt.Sprintf("Adres %d", i)), auth.MaxSavedAddresses); err != nil {
			t.Fatalf("%d. adres eklenmeli: %v", i+1, err)
		}
	}
	if _, err := users.AddAddress(t.Context(), user.ID, savedAddress("Fazla"), auth.MaxSavedAddresses); !errors.Is(err, auth.ErrAddressBookFull) {
		t.Errorf("dolu defter ErrAddressBookFull donmeli: %v", err)
	}
	if _, err := users.AddAddress(t.Context(), ids.New(ids.User), savedAddress("Ev"), auth.MaxSavedAddresses); !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("olmayan kullanici ErrUserNotFound donmeli: %v", err)
	}
}

func TestConcurrentAddAddressKeepsTitleUniqueAndBookBounded(t *testing.T) {
	// "Once oku, sonra yaz" bu yarista ayni adi iki kez ya da siniri asan
	// adresi yazardi; karar tek FindOneAndUpdate'in filtresinde.
	db := testDatabase(t)
	users := authstore.NewMongoUsers(db)
	user := newUser("+905321234567")
	for i := range auth.MaxSavedAddresses - 2 {
		user.Addresses = append(user.Addresses, savedAddress(fmt.Sprintf("Adres %d", i)))
	}
	if err := users.Create(t.Context(), user); err != nil {
		t.Fatalf("kullanici yazilamadi: %v", err)
	}

	// Ayni ad: bir kez.
	sameTitle := race(func() error {
		_, err := users.AddAddress(t.Context(), user.ID, savedAddress("Ev"), auth.MaxSavedAddresses)
		return err
	})
	if added, taken := countOutcomes(sameTitle, auth.ErrAddressTitleTaken); added != 1 || taken != concurrency-1 {
		t.Errorf("ayni ad bir kez eklenmeli: eklenen %d, reddedilen %d (%v)", added, taken, sameTitle)
	}

	// Farkli adlar, tek bos yer: siniri yalnizca biri doldurur.
	var mu sync.Mutex
	next := 0
	distinct := race(func() error {
		mu.Lock()
		next++
		title := fmt.Sprintf("Yeni %d", next)
		mu.Unlock()
		_, err := users.AddAddress(t.Context(), user.ID, savedAddress(title), auth.MaxSavedAddresses)
		return err
	})
	if added, full := countOutcomes(distinct, auth.ErrAddressBookFull); added != 1 || full != concurrency-1 {
		t.Errorf("son bos yeri bir istek almali: eklenen %d, dolu %d (%v)", added, full, distinct)
	}
	if read, err := users.ByID(t.Context(), user.ID); err != nil || len(read.Addresses) != auth.MaxSavedAddresses {
		t.Errorf("defter siniri asmamali: %d adres (%v)", len(read.Addresses), err)
	}
}

// countOutcomes, yaris sonucunda basarili ve beklenen hatayla reddedilen sayisi.
func countOutcomes(errs []error, rejection error) (succeeded, rejected int) {
	for _, err := range errs {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, rejection):
			rejected++
		}
	}
	return succeeded, rejected
}

// addressWithID, kimlikli kayitli adres (T11.15).
func addressWithID(title string) auth.SavedAddress {
	address := savedAddress(title)
	address.ID = ids.New(ids.Address)
	return address
}

func TestUpdateAndDeleteAddressOnMongo(t *testing.T) {
	users := authstore.NewMongoUsers(testDatabase(t))
	user := newUser("+905321234567")
	home, work, mother := addressWithID("Ev"), addressWithID("İş"), addressWithID("Annem")
	user.Addresses = []auth.SavedAddress{home, work, mother}
	if err := users.Create(t.Context(), user); err != nil {
		t.Fatalf("kullanici yazilamadi: %v", err)
	}

	changed := savedAddress("Ofis")
	changed.ID, changed.Kind, changed.Building, changed.Note = work.ID, auth.AddressKindWork, "", ""
	updated, err := users.UpdateAddress(t.Context(), user.ID, changed)
	if err != nil || len(updated.Addresses) != 3 || updated.Addresses[1] != changed || updated.Addresses[0] != home || updated.Addresses[2] != mother {
		t.Fatalf("yalnizca hedef satir yerinde degismeli (bos alanlar silinir): %+v %v", updated.Addresses, err)
	}
	if read, err := users.ByID(t.Context(), user.ID); err != nil || read.Addresses[1] != changed {
		t.Errorf("okunan defter guncellenenle ayni olmali: %+v %v", read.Addresses, err)
	}
	same := home
	same.Note = "Yeni tarif"
	if _, err := users.UpdateAddress(t.Context(), user.ID, same); err != nil {
		t.Errorf("adres kendi adini koruyabilmeli: %v", err)
	}

	taken := savedAddress("Annem")
	taken.ID = home.ID
	if _, err := users.UpdateAddress(t.Context(), user.ID, taken); !errors.Is(err, auth.ErrAddressTitleTaken) {
		t.Errorf("baska adresin adi ErrAddressTitleTaken donmeli: %v", err)
	}
	if _, err := users.UpdateAddress(t.Context(), user.ID, addressWithID("Yok")); !errors.Is(err, auth.ErrAddressNotFound) {
		t.Errorf("olmayan kimlik ErrAddressNotFound donmeli: %v", err)
	}
	// Olmayan kimlik + defterde olan ad: once kimlik sorulur (bellek deposuyla
	// ayni sira; canli testte yakalandi: 404 yerine 400 donuyordu).
	if _, err := users.UpdateAddress(t.Context(), user.ID, addressWithID("Annem")); !errors.Is(err, auth.ErrAddressNotFound) {
		t.Errorf("olmayan kimlik, ad catissa da ErrAddressNotFound donmeli: %v", err)
	}
	if _, err := users.UpdateAddress(t.Context(), ids.New(ids.User), changed); !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("olmayan kullanici ErrUserNotFound donmeli: %v", err)
	}

	left, err := users.DeleteAddress(t.Context(), user.ID, work.ID)
	if err != nil || len(left.Addresses) != 2 || left.Addresses[0].ID != home.ID || left.Addresses[1] != mother {
		t.Fatalf("yalnizca hedef silinmeli, sira korunmali: %+v %v", left.Addresses, err)
	}
	if _, err := users.DeleteAddress(t.Context(), user.ID, work.ID); !errors.Is(err, auth.ErrAddressNotFound) {
		t.Errorf("silinmis adres ErrAddressNotFound donmeli: %v", err)
	}
	if _, err := users.DeleteAddress(t.Context(), ids.New(ids.User), home.ID); !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("olmayan kullanici ErrUserNotFound donmeli: %v", err)
	}
}

func TestConcurrentRenamesOnMongoKeepTitlesUnique(t *testing.T) {
	// "Once oku, sonra yaz" bu yarista iki adrese ayni adi verirdi; karar tek
	// FindOneAndUpdate'in filtresinde ($not $elemMatch).
	users := authstore.NewMongoUsers(testDatabase(t))
	user := newUser("+905321234567")
	for i := range auth.MaxSavedAddresses {
		user.Addresses = append(user.Addresses, addressWithID(fmt.Sprintf("Adres %d", i)))
	}
	if err := users.Create(t.Context(), user); err != nil {
		t.Fatalf("kullanici yazilamadi: %v", err)
	}

	var wg sync.WaitGroup
	errs := make([]error, len(user.Addresses))
	for i, address := range user.Addresses {
		wg.Go(func() {
			renamed := address
			renamed.Title = "Yeni"
			_, errs[i] = users.UpdateAddress(t.Context(), user.ID, renamed)
		})
	}
	wg.Wait()

	if renamed, taken := countOutcomes(errs, auth.ErrAddressTitleTaken); renamed != 1 || taken != len(errs)-1 {
		t.Errorf("ayni ada yalnizca bir adres gecmeli: %d gecti, %d reddedildi (%v)", renamed, taken, errs)
	}
	read, err := users.ByID(t.Context(), user.ID)
	if err != nil {
		t.Fatalf("okuma: %v", err)
	}
	titles := map[string]int{}
	for _, address := range read.Addresses {
		titles[address.Title]++
	}
	if titles["Yeni"] != 1 || len(titles) != auth.MaxSavedAddresses {
		t.Errorf("defterde adlar tekil kalmali: %v", titles)
	}
}

func TestConcurrentUpdateAndDeleteNeverResurrectTheAddress(t *testing.T) {
	// Guncelleme yalnizca var olan satiri degistirir (arrayFilters); silme ile
	// yaristiginda silinmis adres geri gelmez.
	users := authstore.NewMongoUsers(testDatabase(t))
	user := newUser("+905321234567")
	if err := users.Create(t.Context(), user); err != nil {
		t.Fatalf("kullanici yazilamadi: %v", err)
	}
	for round := range concurrency {
		address := addressWithID(fmt.Sprintf("Tur %d", round))
		if _, err := users.AddAddress(t.Context(), user.ID, address, auth.MaxSavedAddresses); err != nil {
			t.Fatalf("adres eklenemedi: %v", err)
		}
		var wg sync.WaitGroup
		var updateErr, deleteErr error
		wg.Go(func() {
			changed := address
			changed.Note = "yarista"
			_, updateErr = users.UpdateAddress(t.Context(), user.ID, changed)
		})
		wg.Go(func() { _, deleteErr = users.DeleteAddress(t.Context(), user.ID, address.ID) })
		wg.Wait()

		if deleteErr != nil || (updateErr != nil && !errors.Is(updateErr, auth.ErrAddressNotFound)) {
			t.Fatalf("tur %d: silme basarmali, guncelleme ya basarir ya NotFound: %v / %v", round, deleteErr, updateErr)
		}
		read, err := users.ByID(t.Context(), user.ID)
		if err != nil || len(read.Addresses) != 0 {
			t.Fatalf("tur %d: silinen adres geri gelmemeli: %+v %v", round, read.Addresses, err)
		}
	}
}

func TestSetPasswordHashAndRevokeAllForUser(t *testing.T) {
	db := testDatabase(t)
	users, sessions := authstore.NewMongoUsers(db), authstore.NewMongoSessions(db)
	user, neighbour := newUser("+905321234567"), newUser("+905321234568")
	for _, u := range []auth.User{user, neighbour} {
		if err := users.Create(t.Context(), u); err != nil {
			t.Fatalf("kullanici yazilamadi: %v", err)
		}
	}
	expires := time.Now().Add(time.Hour)
	for _, s := range []auth.Session{newSession(user.ID, "ozet-1", expires), newSession(user.ID, "ozet-2", expires), newSession(neighbour.ID, "ozet-3", expires)} {
		if err := sessions.Create(t.Context(), s); err != nil {
			t.Fatalf("oturum yazilamadi: %v", err)
		}
	}

	if err := users.SetPasswordHash(t.Context(), user.ID, "$2a$04$yeni"); err != nil {
		t.Fatalf("sifre yazilamadi: %v", err)
	}
	if read, err := users.ByID(t.Context(), user.ID); err != nil || read.PasswordHash != "$2a$04$yeni" || read.Phone != user.Phone {
		t.Errorf("yalnizca ozet degismeli: %+v %v", read, err)
	}
	if err := users.SetPasswordHash(t.Context(), ids.New(ids.User), "$2a$04$x"); !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("olmayan kullanici ErrUserNotFound donmeli: %v", err)
	}

	revoked, err := sessions.RevokeAllForUser(t.Context(), user.ID)
	if err != nil || revoked != 2 {
		t.Fatalf("kullanicinin iki oturumu silinmeli: %d %v", revoked, err)
	}
	if count, err := db.Collection(authstore.SessionsCollection).CountDocuments(t.Context(), bson.D{}); err != nil || count != 1 {
		t.Errorf("baska kullanicinin oturumu kalmali: %d %v", count, err)
	}
}

func favoriteEntry(marketID string, addedAt time.Time) favorites.Entry {
	return favorites.Entry{MarketID: marketID, AddedAt: addedAt.UTC().Truncate(time.Millisecond)}
}

func TestFavoritesOnMongoRoundTripAndRules(t *testing.T) {
	// T11.13: en yeni basta, idempotent ekleme ve cikarma, sinir, olmayan kullanici.
	db := testDatabase(t)
	users, store := authstore.NewMongoUsers(db), authstore.NewMongoFavorites(db)
	user := newUser("+905321234567")
	if err := users.Create(t.Context(), user); err != nil {
		t.Fatalf("kullanici yazilamadi: %v", err)
	}
	start := time.Now()

	// Favori alani hic yazilmamis hesap ($ifNull): bos liste, sonra ilk favori.
	if entries, err := store.List(t.Context(), user.ID); err != nil || len(entries) != 0 {
		t.Fatalf("bos liste bekleniyordu: %+v %v", entries, err)
	}
	for i, marketID := range []string{"mkt_a101-caferaga", "mkt_moda-kasabi"} {
		if err := store.Add(t.Context(), user.ID, favoriteEntry(marketID, start.Add(time.Duration(i)*time.Second)), favorites.MaxMarkets); err != nil {
			t.Fatalf("%s eklenmeli: %v", marketID, err)
		}
	}
	// Ayni market tekrar: degismez (eklenme zamani da korunur).
	if err := store.Add(t.Context(), user.ID, favoriteEntry("mkt_a101-caferaga", start.Add(time.Hour)), favorites.MaxMarkets); err != nil {
		t.Fatalf("tekrar ekleme basarili olmali: %v", err)
	}
	entries, err := store.List(t.Context(), user.ID)
	want := []favorites.Entry{favoriteEntry("mkt_moda-kasabi", start.Add(time.Second)), favoriteEntry("mkt_a101-caferaga", start)}
	if err != nil || len(entries) != 2 || entries[0] != want[0] || entries[1] != want[1] {
		t.Errorf("en yeni once ve tekrar yok:\n got %+v\nwant %+v (%v)", entries, want, err)
	}

	// Cikarma iki kez de basarili.
	for range 2 {
		if err := store.Remove(t.Context(), user.ID, "mkt_moda-kasabi"); err != nil {
			t.Fatalf("cikarma basarili olmali: %v", err)
		}
	}
	if entries, err := store.List(t.Context(), user.ID); err != nil || len(entries) != 1 || entries[0].MarketID != "mkt_a101-caferaga" {
		t.Errorf("cikarilan favori listede olmamali: %+v %v", entries, err)
	}

	// Sinir: max'a kadar eklenir, fazlasi ErrListFull.
	for i := 1; i < favorites.MaxMarkets; i++ {
		if err := store.Add(t.Context(), user.ID, favoriteEntry(fmt.Sprintf("mkt_m%d", i), start), favorites.MaxMarkets); err != nil {
			t.Fatalf("%d. favori eklenmeli: %v", i+1, err)
		}
	}
	if err := store.Add(t.Context(), user.ID, favoriteEntry("mkt_fazla", start), favorites.MaxMarkets); !errors.Is(err, favorites.ErrListFull) {
		t.Errorf("dolu liste ErrListFull donmeli: %v", err)
	}
	// Dolu listede zaten favori olan market: yine basarili (idempotent).
	if err := store.Add(t.Context(), user.ID, favoriteEntry("mkt_a101-caferaga", start), favorites.MaxMarkets); err != nil {
		t.Errorf("dolu listede mevcut favori basarili olmali: %v", err)
	}

	stranger := ids.New(ids.User)
	if _, err := store.List(t.Context(), stranger); !errors.Is(err, favorites.ErrUserNotFound) {
		t.Errorf("olmayan kullanici List ErrUserNotFound: %v", err)
	}
	if err := store.Add(t.Context(), stranger, favoriteEntry("mkt_a101-caferaga", start), favorites.MaxMarkets); !errors.Is(err, favorites.ErrUserNotFound) {
		t.Errorf("olmayan kullanici Add ErrUserNotFound: %v", err)
	}
	if err := store.Remove(t.Context(), stranger, "mkt_a101-caferaga"); !errors.Is(err, favorites.ErrUserNotFound) {
		t.Errorf("olmayan kullanici Remove ErrUserNotFound: %v", err)
	}
}

func TestConcurrentFavoriteAddsStayUniqueAndBounded(t *testing.T) {
	// "Once oku, sonra yaz" ayni marketi iki kez ya da siniri asan favoriyi
	// yazardi; karar tek UpdateOne'in filtresinde.
	db := testDatabase(t)
	users, store := authstore.NewMongoUsers(db), authstore.NewMongoFavorites(db)
	user := newUser("+905321234567")
	if err := users.Create(t.Context(), user); err != nil {
		t.Fatalf("kullanici yazilamadi: %v", err)
	}
	now := time.Now()

	same := race(func() error {
		return store.Add(t.Context(), user.ID, favoriteEntry("mkt_sok-moda", now), favorites.MaxMarkets)
	})
	if succeeded, _ := countOutcomes(same, nil); succeeded != concurrency {
		t.Errorf("ayni market: hepsi basarili (idempotent) olmali: %v", same)
	}
	if entries, err := store.List(t.Context(), user.ID); err != nil || len(entries) != 1 {
		t.Errorf("ayni market bir kez yazilmali: %+v %v", entries, err)
	}

	for i := 1; i < favorites.MaxMarkets-1; i++ {
		if err := store.Add(t.Context(), user.ID, favoriteEntry(fmt.Sprintf("mkt_m%d", i), now), favorites.MaxMarkets); err != nil {
			t.Fatalf("hazirlik: %v", err)
		}
	}
	var mu sync.Mutex
	next := 0
	distinct := race(func() error {
		mu.Lock()
		next++
		marketID := fmt.Sprintf("mkt_yeni-%d", next)
		mu.Unlock()
		return store.Add(t.Context(), user.ID, favoriteEntry(marketID, now), favorites.MaxMarkets)
	})
	if added, full := countOutcomes(distinct, favorites.ErrListFull); added != 1 || full != concurrency-1 {
		t.Errorf("son bos yeri bir istek almali: eklenen %d, dolu %d (%v)", added, full, distinct)
	}
	if entries, err := store.List(t.Context(), user.ID); err != nil || len(entries) != favorites.MaxMarkets {
		t.Errorf("liste siniri asmamali: %d %v", len(entries), err)
	}
}

func TestVerifiedEmailRoundTripAndUniqueness(t *testing.T) {
	// T11.14: dogrulanmis adres kullanici belgesinde; e-postasiz hesaplar
	// (alan yok) kismi indekse girmez, iki hesapta ayni adres olamaz.
	db := testDatabase(t)
	users := authstore.NewMongoUsers(db)
	ayse, mehmet, cansu := newUser("+905321234567"), newUser("+905321234568"), newUser("+905321234569")
	for _, u := range []auth.User{ayse, mehmet, cansu} {
		if err := users.Create(t.Context(), u); err != nil {
			t.Fatalf("kullanici yazilamadi: %v", err)
		}
	}
	verifiedAt := time.Now().UTC().Truncate(time.Millisecond)

	if err := users.SetVerifiedEmail(t.Context(), ayse.ID, "ayse@ornek.com", verifiedAt); err != nil {
		t.Fatalf("adres yazilamadi: %v", err)
	}
	read, err := users.ByID(t.Context(), ayse.ID)
	if err != nil || read.Email != "ayse@ornek.com" || !read.EmailVerifiedAt.Equal(verifiedAt) || read.Profile().Email != "ayse@ornek.com" {
		t.Errorf("adres ve zamani okunmali: %+v (%v)", read, err)
	}
	if owner, err := users.EmailOwner(t.Context(), "ayse@ornek.com"); err != nil || owner != ayse.ID {
		t.Errorf("adresin sahibi: %q (%v)", owner, err)
	}
	if owner, err := users.EmailOwner(t.Context(), "yok@ornek.com"); err != nil || owner != "" {
		t.Errorf("kimsede olmayan adres bos donmeli: %q (%v)", owner, err)
	}
	if err := users.SetVerifiedEmail(t.Context(), mehmet.ID, "ayse@ornek.com", verifiedAt); !errors.Is(err, auth.ErrEmailTaken) {
		t.Errorf("baska hesaptaki adres ErrEmailTaken donmeli: %v", err)
	}
	if err := users.SetVerifiedEmail(t.Context(), ids.New(ids.User), "yeni@ornek.com", verifiedAt); !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("olmayan kullanici ErrUserNotFound donmeli: %v", err)
	}
	// Adres degisince eskisi serbest kalir.
	if err := users.SetVerifiedEmail(t.Context(), ayse.ID, "ayse.yeni@ornek.com", verifiedAt); err != nil {
		t.Fatalf("adres degistirilemedi: %v", err)
	}
	if err := users.SetVerifiedEmail(t.Context(), mehmet.ID, "ayse@ornek.com", verifiedAt); err != nil {
		t.Errorf("serbest kalan adres alinabilmeli: %v", err)
	}
	if read, err := users.ByID(t.Context(), cansu.ID); err != nil || read.Email != "" || !read.EmailVerifiedAt.IsZero() {
		t.Errorf("e-postasiz hesap bos kalmali: %+v (%v)", read, err)
	}
}

func TestConcurrentVerificationsOfOneEmailSucceedOnce(t *testing.T) {
	// Iki hesap ayni adresi ayni anda dogrularsa karar benzersiz indekstedir.
	db := testDatabase(t)
	users := authstore.NewMongoUsers(db)
	accounts := make([]auth.User, concurrency)
	for i := range concurrency {
		accounts[i] = newUser(fmt.Sprintf("+90532123%04d", i))
		if err := users.Create(t.Context(), accounts[i]); err != nil {
			t.Fatalf("kullanici yazilamadi: %v", err)
		}
	}
	var next sync.Mutex
	index := 0

	errs := race(func() error {
		next.Lock()
		user := accounts[index]
		index++
		next.Unlock()
		return users.SetVerifiedEmail(context.Background(), user.ID, "ortak@ornek.com", time.Now().UTC())
	})

	if verified, taken := countOutcomes(errs, auth.ErrEmailTaken); verified != 1 || taken != concurrency-1 {
		t.Errorf("tek hesap dogrulamali: %d dogrulandi, %d reddedildi (%v)", verified, taken, errs)
	}
}

func TestSetFullNameAndVerifiedPhoneOnMongo(t *testing.T) {
	// T11.14 PR 3: ad degistirme ve SMS koduyla dogrulanan numara.
	db := testDatabase(t)
	users := authstore.NewMongoUsers(db)
	ayse, mehmet := newUser("+905321234567"), newUser("+905321234568")
	for _, u := range []auth.User{ayse, mehmet} {
		if err := users.Create(t.Context(), u); err != nil {
			t.Fatalf("kullanici yazilamadi: %v", err)
		}
	}
	verifiedAt := time.Now().UTC().Truncate(time.Millisecond)

	if err := users.SetFullName(t.Context(), ayse.ID, "Ayşe Kaya"); err != nil {
		t.Fatalf("ad yazilamadi: %v", err)
	}
	if err := users.SetVerifiedPhone(t.Context(), ayse.ID, "+905559876543", verifiedAt); err != nil {
		t.Fatalf("numara yazilamadi: %v", err)
	}
	read, err := users.ByID(t.Context(), ayse.ID)
	if err != nil || read.FullName != "Ayşe Kaya" || read.Phone != "+905559876543" || !read.PhoneVerifiedAt.Equal(verifiedAt) || !read.Profile().PhoneVerified {
		t.Errorf("ad, numara ve dogrulama ani okunmali: %+v (%v)", read, err)
	}
	if _, err := users.ByPhone(t.Context(), "+905321234567"); !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("eski numara serbest kalmali: %v", err)
	}
	if err := users.SetVerifiedPhone(t.Context(), mehmet.ID, "+905559876543", verifiedAt); !errors.Is(err, auth.ErrPhoneTaken) {
		t.Errorf("baska hesaptaki numara ErrPhoneTaken donmeli: %v", err)
	}
	unknown := ids.New(ids.User)
	if err := users.SetFullName(t.Context(), unknown, "Yok"); !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("olmayan kullanici (ad): %v", err)
	}
	if err := users.SetVerifiedPhone(t.Context(), unknown, "+905550001111", verifiedAt); !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("olmayan kullanici (numara): %v", err)
	}
	if read, err := users.ByID(t.Context(), mehmet.ID); err != nil || !read.PhoneVerifiedAt.IsZero() || read.Profile().PhoneVerified {
		t.Errorf("dogrulanmamis numara: %+v", read)
	}
}

func TestRevokeOthersKeepsOneSession(t *testing.T) {
	db := testDatabase(t)
	sessions := authstore.NewMongoSessions(db)
	user, neighbour := ids.New(ids.User), ids.New(ids.User)
	expires := time.Now().Add(time.Hour)
	keep := newSession(user, "ozet-bu", expires)
	for _, session := range []auth.Session{keep, newSession(user, "ozet-diger-1", expires), newSession(user, "ozet-diger-2", expires), newSession(neighbour, "ozet-komsu", expires)} {
		if err := sessions.Create(t.Context(), session); err != nil {
			t.Fatalf("oturum yazilamadi: %v", err)
		}
	}

	revoked, err := sessions.RevokeOthers(t.Context(), user, keep.ID)

	if err != nil || revoked != 2 {
		t.Fatalf("iki oturum silinmeli: %d (%v)", revoked, err)
	}
	if _, err := sessions.ByID(t.Context(), keep.ID); err != nil {
		t.Errorf("tutulan oturum kalmali: %v", err)
	}
	if revoked, err := sessions.RevokeAllForUser(t.Context(), neighbour); err != nil || revoked != 1 {
		t.Errorf("baska kullanicinin oturumuna dokunulmamali: %d", revoked)
	}
}
