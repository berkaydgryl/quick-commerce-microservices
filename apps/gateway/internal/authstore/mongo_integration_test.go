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
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/mongodb"
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
