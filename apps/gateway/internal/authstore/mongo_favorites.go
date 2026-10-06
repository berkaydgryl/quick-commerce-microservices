package authstore

import (
	"context"
	"errors"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/favorites"
)

// MongoFavorites, favori marketlerin deposu (T11.13): kullanici belgesindeki
// favoriteMarkets dizisi (adres defteri gibi; ayri koleksiyon yok, liste
// sinirli). Yeni favori dizinin BASINA eklenir: okuma en yeniden eskiye.
type MongoFavorites struct {
	collection *mongo.Collection
}

// NewMongoFavorites, depoyu kurar.
func NewMongoFavorites(db *mongo.Database) *MongoFavorites {
	return &MongoFavorites{collection: db.Collection(UsersCollection)}
}

// List, kullanicinin favorileri, en yeni once.
func (m *MongoFavorites) List(ctx context.Context, userID string) ([]favorites.Entry, error) {
	opts := options.FindOne().SetProjection(bson.D{{Key: "favoriteMarkets", Value: 1}})
	var doc userDocument
	err := m.collection.FindOne(ctx, bson.D{{Key: "_id", Value: userID}}, opts).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, favorites.ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("favoriler okunamadi: %w", err)
	}
	entries := make([]favorites.Entry, 0, len(doc.FavoriteMarkets))
	for _, favorite := range doc.FavoriteMarkets {
		entries = append(entries, favorites.Entry{MarketID: favorite.MarketID, AddedAt: favorite.AddedAt})
	}
	return entries, nil
}

// Add, favoriyi TEK atomik guncellemeyle dizinin basina ekler. Filtre iki
// kurali birlikte ister: market zaten favori degil ve liste max'in altinda.
// Es zamanli iki ekleme siniri asamaz, ayni marketi iki kez yazamaz. Eslesme
// yoksa sebep kayit okunarak ayirt edilir: zaten favoriyse basaridir.
func (m *MongoFavorites) Add(ctx context.Context, userID string, entry favorites.Entry, max int) error {
	count := bson.D{{Key: "$size", Value: bson.D{{Key: "$ifNull", Value: bson.A{"$favoriteMarkets", bson.A{}}}}}}
	filter := bson.D{
		{Key: "_id", Value: userID},
		{Key: "favoriteMarkets.marketId", Value: bson.D{{Key: "$ne", Value: entry.MarketID}}},
		{Key: "$expr", Value: bson.D{{Key: "$lt", Value: bson.A{count, max}}}},
	}
	document := favoriteDocument{MarketID: entry.MarketID, AddedAt: entry.AddedAt}
	update := bson.D{{Key: "$push", Value: bson.D{{Key: "favoriteMarkets", Value: bson.D{
		{Key: "$each", Value: bson.A{document}},
		{Key: "$position", Value: 0},
	}}}}}
	result, err := m.collection.UpdateOne(ctx, filter, update)
	if err != nil {
		return fmt.Errorf("favori eklenemedi: %w", err)
	}
	if result.MatchedCount == 1 {
		return nil
	}
	return m.addRejection(ctx, userID, entry.MarketID, max)
}

// addRejection, Add'in filtresi eslesmediginde sebebi soyler.
func (m *MongoFavorites) addRejection(ctx context.Context, userID, marketID string, max int) error {
	entries, err := m.List(ctx, userID)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.MarketID == marketID {
			return nil
		}
	}
	if len(entries) >= max {
		return favorites.ErrListFull
	}
	// Okuma ile guncelleme arasinda baska bir ekleme/cikarma oldu: istemci
	// tekrar dener (Idempotency-Key ayni kalir).
	return fmt.Errorf("favori eklenemedi: liste es zamanli degisti")
}

// Remove, favoriyi cikarir; favori degilse de basarilidir.
func (m *MongoFavorites) Remove(ctx context.Context, userID, marketID string) error {
	result, err := m.collection.UpdateOne(ctx, bson.D{{Key: "_id", Value: userID}},
		bson.D{{Key: "$pull", Value: bson.D{{Key: "favoriteMarkets", Value: bson.D{{Key: "marketId", Value: marketID}}}}}})
	if err != nil {
		return fmt.Errorf("favori cikarilamadi: %w", err)
	}
	if result.MatchedCount == 0 {
		return favorites.ErrUserNotFound
	}
	return nil
}
