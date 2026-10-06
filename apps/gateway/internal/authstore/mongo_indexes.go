package authstore

import (
	"context"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// EnsureIndexes, indeksleri kurar; tekrar calistirmak guvenlidir (ayni tanim).
//
// Indeksler BILDIRIMLIDIR, gocle degil (roadmap T10.4 kurali): users.phone
// benzersizligi kaydin tek dogruluk kaynagidir (iki es zamanli kayit yarisini
// o cozer), sessions.expiresAt TTL'i suresi dolan oturumlari siler. users.email
// (T11.14) KISMI benzersizdir: yalnizca e-postasi olan belgeler indekse girer;
// e-postasiz binlerce hesap "bos deger" uzerinden cakismaz.
func EnsureIndexes(ctx context.Context, db *mongo.Database) error {
	if _, err := db.Collection(UsersCollection).Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "phone", Value: 1}}, Options: options.Index().SetName("phone_unique").SetUnique(true)},
		// "Ayni cihazdan acilmis hesap" sayimi (T8.1). Seyrek: cihazi
		// bilinmeyen eski hesaplar indekse girmez.
		{Keys: bson.D{{Key: "registrationDeviceId", Value: 1}}, Options: options.Index().SetName("registrationDeviceId").SetSparse(true)},
		{Keys: bson.D{{Key: "email", Value: 1}}, Options: options.Index().SetName("email_unique").SetUnique(true).
			SetPartialFilterExpression(bson.D{{Key: "email", Value: bson.D{{Key: "$type", Value: "string"}}}})},
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
