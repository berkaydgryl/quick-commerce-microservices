// Package authstore, kimlik kayitlarinin depolaridir (T8.1): Mongo (gercek) ve
// bellek (MOCK). Surucu hatasini auth paketinin hatalarina cevirir; servis
// Mongo'yu bilmez.
//
// Koleksiyonlar gateway'indir (ADR-05): users (telefon benzersiz) ve sessions
// (yenileme jetonunun ozeti benzersiz, suresi dolan kayit TTL indeksiyle
// kendiliginden silinir).
package authstore

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// Koleksiyon adlari (roadmap koleksiyon tablosu).
const (
	UsersCollection    = "users"
	SessionsCollection = "sessions"
)

type userDocument struct {
	ID                   string            `bson:"_id"`
	Phone                string            `bson:"phone"`
	PasswordHash         string            `bson:"passwordHash"`
	FullName             string            `bson:"fullName"`
	CreatedAt            time.Time         `bson:"createdAt"`
	RegistrationDeviceID string            `bson:"registrationDeviceId,omitempty"`
	LastLoginIP          string            `bson:"lastLoginIp,omitempty"`
	LastLocation         *geoPointDocument `bson:"lastLocation,omitempty"`
	Addresses            []addressDocument `bson:"addresses,omitempty"`
}

type sessionDocument struct {
	ID                string            `bson:"_id"`
	UserID            string            `bson:"userId"`
	TokenHash         string            `bson:"tokenHash"`
	CreatedAt         time.Time         `bson:"createdAt"`
	RefreshedAt       time.Time         `bson:"refreshedAt"`
	ExpiresAt         time.Time         `bson:"expiresAt"`
	IPAddress         string            `bson:"ipAddress,omitempty"`
	DeviceID          string            `bson:"deviceId,omitempty"`
	PreviousIPAddress string            `bson:"previousIpAddress,omitempty"`
	IPCity            string            `bson:"ipCity,omitempty"`
	Location          *geoPointDocument `bson:"location,omitempty"`
}

// geoPointDocument, konum. GeoJSON degil: konum uzerinde cografi sorgu yok,
// yalnizca risk sinyali olarak tasinir.
type geoPointDocument struct {
	Lat float64 `bson:"lat"`
	Lng float64 `bson:"lng"`
}

type addressDocument struct {
	Title     string           `bson:"title"`
	Kind      string           `bson:"kind,omitempty"`
	Line      string           `bson:"line"`
	Location  geoPointDocument `bson:"location"`
	Building  string           `bson:"building,omitempty"`
	Floor     string           `bson:"floor,omitempty"`
	Apartment string           `bson:"apartment,omitempty"`
	Note      string           `bson:"note,omitempty"`
}

// EnsureIndexes, indeksleri kurar; tekrar calistirmak guvenlidir (ayni tanim).
//
// Indeksler BILDIRIMLIDIR, gocle degil (roadmap T10.4 kurali): users.phone
// benzersizligi kaydin tek dogruluk kaynagidir (iki es zamanli kayit yarisini
// o cozer), sessions.expiresAt TTL'i suresi dolan oturumlari siler.
func EnsureIndexes(ctx context.Context, db *mongo.Database) error {
	if _, err := db.Collection(UsersCollection).Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "phone", Value: 1}}, Options: options.Index().SetName("phone_unique").SetUnique(true)},
		// "Ayni cihazdan acilmis hesap" sayimi (T8.1). Seyrek: cihazi
		// bilinmeyen eski hesaplar indekse girmez.
		{Keys: bson.D{{Key: "registrationDeviceId", Value: 1}}, Options: options.Index().SetName("registrationDeviceId").SetSparse(true)},
	}); err != nil {
		return fmt.Errorf("users indeksleri: %w", err)
	}
	if _, err := db.Collection(SessionsCollection).Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "tokenHash", Value: 1}}, Options: options.Index().SetName("tokenHash_unique").SetUnique(true)},
		{Keys: bson.D{{Key: "expiresAt", Value: 1}}, Options: options.Index().SetName("expiresAt_ttl").SetExpireAfterSeconds(0)},
		{Keys: bson.D{{Key: "userId", Value: 1}}, Options: options.Index().SetName("userId")},
	}); err != nil {
		return fmt.Errorf("sessions indeksleri: %w", err)
	}
	return nil
}

// MongoUsers, users koleksiyonu.
type MongoUsers struct {
	collection *mongo.Collection
}

// NewMongoUsers, veritabanindan kurar.
func NewMongoUsers(db *mongo.Database) *MongoUsers {
	return &MongoUsers{collection: db.Collection(UsersCollection)}
}

// Create, kullaniciyi yazar; telefon kayitliysa auth.ErrPhoneTaken. Karar
// benzersiz indekstedir: "once bak, sonra yaz" iki es zamanli kayitta yarisirdi.
func (m *MongoUsers) Create(ctx context.Context, user auth.User) error {
	_, err := m.collection.InsertOne(ctx, toUserDocument(user))
	if mongo.IsDuplicateKeyError(err) {
		return auth.ErrPhoneTaken
	}
	if err != nil {
		return fmt.Errorf("kullanici yazilamadi: %w", err)
	}
	return nil
}

// ByPhone, telefona gore kullanici.
func (m *MongoUsers) ByPhone(ctx context.Context, phone string) (auth.User, error) {
	return m.findOne(ctx, bson.D{{Key: "phone", Value: phone}})
}

// ByID, kimlige gore kullanici.
func (m *MongoUsers) ByID(ctx context.Context, id string) (auth.User, error) {
	return m.findOne(ctx, bson.D{{Key: "_id", Value: id}})
}

func (m *MongoUsers) findOne(ctx context.Context, filter bson.D) (auth.User, error) {
	var doc userDocument
	err := m.collection.FindOne(ctx, filter).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return auth.User{}, auth.ErrUserNotFound
	}
	if err != nil {
		return auth.User{}, fmt.Errorf("kullanici okunamadi: %w", err)
	}
	return fromUserDocument(doc), nil
}

// RecordLogin, girisi TEK atomik guncellemeyle yazar ve guncellemeden ONCEKI
// degerleri doner: es zamanli iki giris ayni "onceki IP"yi okuyamaz.
func (m *MongoUsers) RecordLogin(ctx context.Context, userID string, login auth.LoginState) (auth.LoginState, error) {
	set := bson.D{{Key: "lastLoginIp", Value: login.IPAddress}}
	if login.Location != nil {
		set = append(set, bson.E{Key: "lastLocation", Value: toGeoPointDocument(*login.Location)})
	}
	opts := options.FindOneAndUpdate().
		SetReturnDocument(options.Before).
		SetProjection(bson.D{{Key: "lastLoginIp", Value: 1}, {Key: "lastLocation", Value: 1}})
	var before userDocument
	err := m.collection.FindOneAndUpdate(ctx, bson.D{{Key: "_id", Value: userID}}, bson.D{{Key: "$set", Value: set}}, opts).Decode(&before)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return auth.LoginState{}, auth.ErrUserNotFound
	}
	if err != nil {
		return auth.LoginState{}, fmt.Errorf("giris kaydedilemedi: %w", err)
	}
	return auth.LoginState{IPAddress: before.LastLoginIP, Location: fromGeoPointDocument(before.LastLocation)}, nil
}

// AddAddress, adresi TEK atomik guncellemeyle defterin sonuna ekler (T11.8).
// Filtre iki kurali birlikte ister: ayni adla adres yok ve defter max'in
// altinda. Es zamanli iki ekleme siniri asamaz, ayni adi iki kez yazamaz.
// Eslesme yoksa sebep kayit okunarak ayirt edilir.
func (m *MongoUsers) AddAddress(ctx context.Context, userID string, address auth.SavedAddress, max int) (auth.User, error) {
	addressCount := bson.D{{Key: "$size", Value: bson.D{{Key: "$ifNull", Value: bson.A{"$addresses", bson.A{}}}}}}
	filter := bson.D{
		{Key: "_id", Value: userID},
		{Key: "addresses.title", Value: bson.D{{Key: "$ne", Value: address.Title}}},
		{Key: "$expr", Value: bson.D{{Key: "$lt", Value: bson.A{addressCount, max}}}},
	}
	update := bson.D{{Key: "$push", Value: bson.D{{Key: "addresses", Value: toAddressDocument(address)}}}}
	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var doc userDocument
	err := m.collection.FindOneAndUpdate(ctx, filter, update, opts).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return auth.User{}, m.addressRejection(ctx, userID, address.Title, max)
	}
	if err != nil {
		return auth.User{}, fmt.Errorf("adres eklenemedi: %w", err)
	}
	return fromUserDocument(doc), nil
}

// addressRejection, AddAddress'in filtresi eslesmediginde sebebi soyler.
func (m *MongoUsers) addressRejection(ctx context.Context, userID, title string, max int) error {
	user, err := m.ByID(ctx, userID)
	if err != nil {
		return err
	}
	for _, address := range user.Addresses {
		if address.Title == title {
			return auth.ErrAddressTitleTaken
		}
	}
	if len(user.Addresses) >= max {
		return auth.ErrAddressBookFull
	}
	// Okuma ile guncelleme arasinda baska bir ekleme/silme oldu: istemci
	// tekrar dener (Idempotency-Key ayni kalir).
	return fmt.Errorf("adres eklenemedi: defter es zamanli degisti")
}

// SetPasswordHash, sifre ozetini degistirir (T11.9).
func (m *MongoUsers) SetPasswordHash(ctx context.Context, userID, passwordHash string) error {
	result, err := m.collection.UpdateOne(ctx, bson.D{{Key: "_id", Value: userID}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "passwordHash", Value: passwordHash}}}})
	if err != nil {
		return fmt.Errorf("sifre yazilamadi: %w", err)
	}
	if result.MatchedCount == 0 {
		return auth.ErrUserNotFound
	}
	return nil
}

// CountByRegistrationDevice, cihazdan acilmis hesap sayisi (seyrek indeksle).
func (m *MongoUsers) CountByRegistrationDevice(ctx context.Context, deviceID string) (int, error) {
	count, err := m.collection.CountDocuments(ctx, bson.D{{Key: "registrationDeviceId", Value: deviceID}})
	if err != nil {
		return 0, fmt.Errorf("cihazdaki hesaplar sayilamadi: %w", err)
	}
	return int(count), nil
}

// MongoSessions, sessions koleksiyonu.
type MongoSessions struct {
	collection *mongo.Collection
}

// NewMongoSessions, veritabanindan kurar.
func NewMongoSessions(db *mongo.Database) *MongoSessions {
	return &MongoSessions{collection: db.Collection(SessionsCollection)}
}

// Create, oturumu yazar.
func (m *MongoSessions) Create(ctx context.Context, session auth.Session) error {
	if _, err := m.collection.InsertOne(ctx, toSessionDocument(session)); err != nil {
		return fmt.Errorf("oturum yazilamadi: %w", err)
	}
	return nil
}

// Rotate, jetonu TEK atomik guncellemeyle degistirir: filtre hem eski ozeti hem
// suresinin dolmadigini ister. Ayni eski jetonla gelen iki istekten ilki
// ozeti degistirir; ikincisinin filtresi artik eslesmez (ErrSessionNotFound).
//
// Suresi dolmus ama TTL'in henuz silmedigi kayit da reddedilir: TTL gorevi
// dakikada bir calisir, kurala o gorev beklenmeden uyulur.
func (m *MongoSessions) Rotate(ctx context.Context, oldHash, newHash string, now, expiresAt time.Time) (auth.Session, error) {
	filter := bson.D{{Key: "tokenHash", Value: oldHash}, {Key: "expiresAt", Value: bson.D{{Key: "$gt", Value: now}}}}
	update := bson.D{{Key: "$set", Value: bson.D{
		{Key: "tokenHash", Value: newHash},
		{Key: "refreshedAt", Value: now},
		{Key: "expiresAt", Value: expiresAt},
	}}}
	var doc sessionDocument
	err := m.collection.FindOneAndUpdate(ctx, filter, update, options.FindOneAndUpdate().SetReturnDocument(options.After)).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return auth.Session{}, auth.ErrSessionNotFound
	}
	if err != nil {
		return auth.Session{}, fmt.Errorf("oturum yenilenemedi: %w", err)
	}
	return fromSessionDocument(doc), nil
}

// Revoke, oturumu siler; silindiyse true.
func (m *MongoSessions) Revoke(ctx context.Context, tokenHash string) (bool, error) {
	result, err := m.collection.DeleteOne(ctx, bson.D{{Key: "tokenHash", Value: tokenHash}})
	if err != nil {
		return false, fmt.Errorf("oturum silinemedi: %w", err)
	}
	return result.DeletedCount > 0, nil
}

// RevokeAllForUser, kullanicinin butun oturumlarini tek komutla siler
// (T11.9; userId indeksi).
func (m *MongoSessions) RevokeAllForUser(ctx context.Context, userID string) (int, error) {
	result, err := m.collection.DeleteMany(ctx, bson.D{{Key: "userId", Value: userID}})
	if err != nil {
		return 0, fmt.Errorf("oturumlar silinemedi: %w", err)
	}
	return int(result.DeletedCount), nil
}

// ByID, kimlige gore oturum.
func (m *MongoSessions) ByID(ctx context.Context, id string) (auth.Session, error) {
	var doc sessionDocument
	err := m.collection.FindOne(ctx, bson.D{{Key: "_id", Value: id}}).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return auth.Session{}, auth.ErrSessionNotFound
	}
	if err != nil {
		return auth.Session{}, fmt.Errorf("oturum okunamadi: %w", err)
	}
	return fromSessionDocument(doc), nil
}

func toUserDocument(user auth.User) userDocument {
	doc := userDocument{
		ID: user.ID, Phone: user.Phone, PasswordHash: user.PasswordHash, FullName: user.FullName, CreatedAt: user.CreatedAt,
		RegistrationDeviceID: user.RegistrationDeviceID, LastLoginIP: user.LastLoginIP,
		LastLocation: toGeoPointDocumentPtr(user.LastLocation),
	}
	for _, address := range user.Addresses {
		doc.Addresses = append(doc.Addresses, toAddressDocument(address))
	}
	return doc
}

func toAddressDocument(address auth.SavedAddress) addressDocument {
	return addressDocument{
		Title: address.Title, Kind: address.Kind, Line: address.Line, Location: toGeoPointDocument(address.Location),
		Building: address.Building, Floor: address.Floor, Apartment: address.Apartment, Note: address.Note,
	}
}

func fromAddressDocument(doc addressDocument) auth.SavedAddress {
	return auth.SavedAddress{
		Title: doc.Title, Kind: doc.Kind, Line: doc.Line, Location: auth.GeoPoint(doc.Location),
		Building: doc.Building, Floor: doc.Floor, Apartment: doc.Apartment, Note: doc.Note,
	}
}

func fromUserDocument(doc userDocument) auth.User {
	user := auth.User{
		ID: doc.ID, Phone: doc.Phone, PasswordHash: doc.PasswordHash, FullName: doc.FullName, CreatedAt: doc.CreatedAt,
		RegistrationDeviceID: doc.RegistrationDeviceID, LastLoginIP: doc.LastLoginIP,
		LastLocation: fromGeoPointDocument(doc.LastLocation),
	}
	for _, address := range doc.Addresses {
		user.Addresses = append(user.Addresses, fromAddressDocument(address))
	}
	return user
}

func toSessionDocument(session auth.Session) sessionDocument {
	return sessionDocument{
		ID: session.ID, UserID: session.UserID, TokenHash: session.TokenHash, CreatedAt: session.CreatedAt,
		RefreshedAt: session.RefreshedAt, ExpiresAt: session.ExpiresAt, IPAddress: session.IPAddress,
		DeviceID: session.DeviceID, PreviousIPAddress: session.PreviousIPAddress, IPCity: session.IPCity,
		Location: toGeoPointDocumentPtr(session.Location),
	}
}

func fromSessionDocument(doc sessionDocument) auth.Session {
	return auth.Session{
		ID: doc.ID, UserID: doc.UserID, TokenHash: doc.TokenHash, CreatedAt: doc.CreatedAt,
		RefreshedAt: doc.RefreshedAt, ExpiresAt: doc.ExpiresAt, IPAddress: doc.IPAddress,
		DeviceID: doc.DeviceID, PreviousIPAddress: doc.PreviousIPAddress, IPCity: doc.IPCity,
		Location: fromGeoPointDocument(doc.Location),
	}
}

func toGeoPointDocument(point auth.GeoPoint) geoPointDocument {
	return geoPointDocument(point)
}

// toGeoPointDocumentPtr, istege bagli konum; nil ise alan yazilmaz (omitempty).
func toGeoPointDocumentPtr(point *auth.GeoPoint) *geoPointDocument {
	if point == nil {
		return nil
	}
	doc := toGeoPointDocument(*point)
	return &doc
}

// fromGeoPointDocument, belgedeki konum; alan yoksa nil.
func fromGeoPointDocument(doc *geoPointDocument) *auth.GeoPoint {
	if doc == nil {
		return nil
	}
	point := auth.GeoPoint(*doc)
	return &point
}
