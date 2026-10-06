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

// RevokeOthers, keepSessionID disindaki oturumlari tek komutla siler (T11.14 PR 3).
func (m *MongoSessions) RevokeOthers(ctx context.Context, userID, keepSessionID string) (int, error) {
	result, err := m.collection.DeleteMany(ctx, bson.D{
		{Key: "userId", Value: userID},
		{Key: "_id", Value: bson.D{{Key: "$ne", Value: keepSessionID}}},
	})
	if err != nil {
		return 0, fmt.Errorf("diger oturumlar silinemedi: %w", err)
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
