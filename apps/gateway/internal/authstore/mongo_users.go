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

// EmailOwner, adresi dogrulanmis kullanicinin kimligi; kimsede yoksa "" (T11.14).
// Yalnizca erken uyari icindir: karari SetVerifiedEmail'in benzersiz indeksi verir.
func (m *MongoUsers) EmailOwner(ctx context.Context, email string) (string, error) {
	opts := options.FindOne().SetProjection(bson.D{{Key: "_id", Value: 1}})
	var doc userDocument
	err := m.collection.FindOne(ctx, bson.D{{Key: "email", Value: email}}, opts).Decode(&doc)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("e-posta sahibi okunamadi: %w", err)
	}
	return doc.ID, nil
}

// SetVerifiedEmail, dogrulanmis adresi kullaniciya yazar (T11.14). Adres
// baska hesaptaysa auth.ErrEmailTaken: karar benzersiz indekstedir, iki
// hesabin ayni anda dogrulamasi yarisamaz. Kullanici yoksa auth.ErrUserNotFound.
func (m *MongoUsers) SetVerifiedEmail(ctx context.Context, userID, email string, verifiedAt time.Time) error {
	result, err := m.collection.UpdateOne(ctx, bson.D{{Key: "_id", Value: userID}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "email", Value: email}, {Key: "emailVerifiedAt", Value: verifiedAt}}}})
	if mongo.IsDuplicateKeyError(err) {
		return auth.ErrEmailTaken
	}
	if err != nil {
		return fmt.Errorf("e-posta yazilamadi: %w", err)
	}
	if result.MatchedCount == 0 {
		return auth.ErrUserNotFound
	}
	return nil
}

// SetFullName, adi degistirir (T11.14 PR 3, #89).
func (m *MongoUsers) SetFullName(ctx context.Context, userID, fullName string) error {
	result, err := m.collection.UpdateOne(ctx, bson.D{{Key: "_id", Value: userID}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "fullName", Value: fullName}}}})
	if err != nil {
		return fmt.Errorf("ad yazilamadi: %w", err)
	}
	if result.MatchedCount == 0 {
		return auth.ErrUserNotFound
	}
	return nil
}

// SetVerifiedPhone, SMS koduyla dogrulanan numarayi yazar (T11.14 PR 3):
// numara degistiyse yenisi, degismediyse yalnizca dogrulama ani. Numara baska
// hesaptaysa auth.ErrPhoneTaken: karar users.phone benzersiz indeksindedir, iki
// hesabin ayni numaraya ayni anda gecmesi yarisamaz. Kullanici yoksa
// auth.ErrUserNotFound.
func (m *MongoUsers) SetVerifiedPhone(ctx context.Context, userID, phone string, verifiedAt time.Time) error {
	result, err := m.collection.UpdateOne(ctx, bson.D{{Key: "_id", Value: userID}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "phone", Value: phone}, {Key: "phoneVerifiedAt", Value: verifiedAt}}}})
	if mongo.IsDuplicateKeyError(err) {
		return auth.ErrPhoneTaken
	}
	if err != nil {
		return fmt.Errorf("numara yazilamadi: %w", err)
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
