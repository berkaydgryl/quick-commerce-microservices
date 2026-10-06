package authstore

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

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

// UpdateAddress, adresi TEK atomik guncellemeyle degistirir (T11.15). Filtre
// iki kurali birlikte ister: kimlik defterde var ve ayni ad BASKA bir adreste
// yok. Ayni ada es zamanli iki yeniden adlandirmadan yalnizca biri basarir.
// Satir arrayFilters ile secilir: filtrede iki dizi kosulu oldugu icin
// konumsal "$" hangi eslesmeyi gosterdigi belirsiz kalirdi.
func (m *MongoUsers) UpdateAddress(ctx context.Context, userID string, address auth.SavedAddress) (auth.User, error) {
	filter := bson.D{
		{Key: "_id", Value: userID},
		{Key: "addresses.id", Value: address.ID},
		{Key: "addresses", Value: bson.D{{Key: "$not", Value: bson.D{{Key: "$elemMatch", Value: bson.D{
			{Key: "title", Value: address.Title},
			{Key: "id", Value: bson.D{{Key: "$ne", Value: address.ID}}},
		}}}}}},
	}
	update := bson.D{{Key: "$set", Value: bson.D{{Key: "addresses.$[target]", Value: toAddressDocument(address)}}}}
	opts := options.FindOneAndUpdate().
		SetArrayFilters([]any{bson.D{{Key: "target.id", Value: address.ID}}}).
		SetReturnDocument(options.After)
	var doc userDocument
	err := m.collection.FindOneAndUpdate(ctx, filter, update, opts).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return auth.User{}, m.addressChangeRejection(ctx, userID, address)
	}
	if err != nil {
		return auth.User{}, fmt.Errorf("adres guncellenemedi: %w", err)
	}
	return fromUserDocument(doc), nil
}

// DeleteAddress, adresi TEK atomik $pull ile cikarir (T11.15).
func (m *MongoUsers) DeleteAddress(ctx context.Context, userID, addressID string) (auth.User, error) {
	filter := bson.D{{Key: "_id", Value: userID}, {Key: "addresses.id", Value: addressID}}
	update := bson.D{{Key: "$pull", Value: bson.D{{Key: "addresses", Value: bson.D{{Key: "id", Value: addressID}}}}}}
	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var doc userDocument
	err := m.collection.FindOneAndUpdate(ctx, filter, update, opts).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		if _, readErr := m.ByID(ctx, userID); readErr != nil {
			return auth.User{}, readErr
		}
		return auth.User{}, auth.ErrAddressNotFound
	}
	if err != nil {
		return auth.User{}, fmt.Errorf("adres silinemedi: %w", err)
	}
	return fromUserDocument(doc), nil
}

// addressChangeRejection, UpdateAddress'in filtresi eslesmediginde sebebi soyler.
// Sira bellek deposuyla ayni: once adres var mi (yoksa ad catismasi sorulmaz),
// sonra ad baska adreste mi.
func (m *MongoUsers) addressChangeRejection(ctx context.Context, userID string, address auth.SavedAddress) error {
	user, err := m.ByID(ctx, userID)
	if err != nil {
		return err
	}
	if !slices.ContainsFunc(user.Addresses, func(existing auth.SavedAddress) bool { return existing.ID == address.ID }) {
		return auth.ErrAddressNotFound
	}
	if slices.ContainsFunc(user.Addresses, func(existing auth.SavedAddress) bool {
		return existing.ID != address.ID && existing.Title == address.Title
	}) {
		return auth.ErrAddressTitleTaken
	}
	// Okuma ile guncelleme arasinda baska bir degisiklik oldu: istemci tekrar
	// dener (Idempotency-Key ayni kalir).
	return fmt.Errorf("adres guncellenemedi: defter es zamanli degisti")
}
