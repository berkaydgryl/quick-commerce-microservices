package authstore

import (
	"context"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// ReplaceUsers, hesaplari bastan yazar (persona seed'i, T8.1): ayni kimlikli
// ya da ayni telefonlu kayitlar ve bu kullanicilarin oturumlari silinir,
// hesaplar yeniden eklenir. Tekrar calistirmak guvenlidir. Indeksler once
// kurulmus olmalidir (EnsureIndexes).
//
// Ayni telefonla elle acilmis bir hesap da silinir: demo numaralari
// (+90555...) personalara ayrilmistir; aksi halde benzersiz telefon indeksi
// seed'i durdururdu.
func ReplaceUsers(ctx context.Context, db *mongo.Database, users []auth.User) error {
	userIDs := make(bson.A, 0, len(users))
	phones := make(bson.A, 0, len(users))
	docs := make([]any, 0, len(users))
	for _, user := range users {
		userIDs = append(userIDs, user.ID)
		phones = append(phones, user.Phone)
		docs = append(docs, toUserDocument(user))
	}
	collection := db.Collection(UsersCollection)

	// Silinecek hesaplarin kimlikleri: telefonla eslesen elle acilmis hesabin
	// oturumlari da gitsin.
	cursor, err := collection.Find(ctx,
		bson.D{{Key: "$or", Value: bson.A{
			bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: userIDs}}}},
			bson.D{{Key: "phone", Value: bson.D{{Key: "$in", Value: phones}}}},
		}}},
		options.Find().SetProjection(bson.D{{Key: "_id", Value: 1}}))
	if err != nil {
		return fmt.Errorf("eski hesaplar okunamadi: %w", err)
	}
	var existing []struct {
		ID string `bson:"_id"`
	}
	if err := cursor.All(ctx, &existing); err != nil {
		return fmt.Errorf("eski hesaplar okunamadi: %w", err)
	}
	stale := make(bson.A, 0, len(existing))
	for _, doc := range existing {
		stale = append(stale, doc.ID)
	}

	if _, err := db.Collection(SessionsCollection).DeleteMany(ctx, bson.D{{Key: "userId", Value: bson.D{{Key: "$in", Value: stale}}}}); err != nil {
		return fmt.Errorf("eski oturumlar silinemedi: %w", err)
	}
	if _, err := collection.DeleteMany(ctx, bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: stale}}}}); err != nil {
		return fmt.Errorf("eski hesaplar silinemedi: %w", err)
	}
	if _, err := collection.InsertMany(ctx, docs); err != nil {
		return fmt.Errorf("hesaplar yazilamadi: %w", err)
	}
	return nil
}
