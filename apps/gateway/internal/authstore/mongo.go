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
	ID           string    `bson:"_id"`
	Phone        string    `bson:"phone"`
	PasswordHash string    `bson:"passwordHash"`
	FullName     string    `bson:"fullName"`
	CreatedAt    time.Time `bson:"createdAt"`
}

type sessionDocument struct {
	ID          string    `bson:"_id"`
	UserID      string    `bson:"userId"`
	TokenHash   string    `bson:"tokenHash"`
	CreatedAt   time.Time `bson:"createdAt"`
	RefreshedAt time.Time `bson:"refreshedAt"`
	ExpiresAt   time.Time `bson:"expiresAt"`
	IPAddress   string    `bson:"ipAddress,omitempty"`
}

// EnsureIndexes, indeksleri kurar; tekrar calistirmak guvenlidir (ayni tanim).
//
// Indeksler BILDIRIMLIDIR, gocle degil (roadmap T10.4 kurali): users.phone
// benzersizligi kaydin tek dogruluk kaynagidir (iki es zamanli kayit yarisini
// o cozer), sessions.expiresAt TTL'i suresi dolan oturumlari siler.
func EnsureIndexes(ctx context.Context, db *mongo.Database) error {
	if _, err := db.Collection(UsersCollection).Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "phone", Value: 1}}, Options: options.Index().SetName("phone_unique").SetUnique(true)},
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
	_, err := m.collection.InsertOne(ctx, userDocument{
		ID: user.ID, Phone: user.Phone, PasswordHash: user.PasswordHash, FullName: user.FullName, CreatedAt: user.CreatedAt,
	})
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
	return auth.User{ID: doc.ID, Phone: doc.Phone, PasswordHash: doc.PasswordHash, FullName: doc.FullName, CreatedAt: doc.CreatedAt}, nil
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

func toSessionDocument(session auth.Session) sessionDocument {
	return sessionDocument{
		ID: session.ID, UserID: session.UserID, TokenHash: session.TokenHash, CreatedAt: session.CreatedAt,
		RefreshedAt: session.RefreshedAt, ExpiresAt: session.ExpiresAt, IPAddress: session.IPAddress,
	}
}

func fromSessionDocument(doc sessionDocument) auth.Session {
	return auth.Session{
		ID: doc.ID, UserID: doc.UserID, TokenHash: doc.TokenHash, CreatedAt: doc.CreatedAt,
		RefreshedAt: doc.RefreshedAt, ExpiresAt: doc.ExpiresAt, IPAddress: doc.IPAddress,
	}
}
