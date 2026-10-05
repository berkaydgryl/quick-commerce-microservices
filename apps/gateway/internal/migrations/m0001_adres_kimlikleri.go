package migrations

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strconv"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

// 0001-adres-kimlikleri (T11.15): kayitli adreslere kalici kimlik.
//
// T11.15'e kadar adres defterinin satirlari adla taninirdi; duzenleme adi
// degistirebildigi icin her adres `id` (adr_ + 32 kucuk onaltilik) alir. Yeni
// adreslere kimligi gateway verir; bu goc ONCEKI kayitlara verir.
//
// DONMUS KOPYA: kimlik bicimi ve alan adlari burada yazilidir (ids, auth ve
// authstore'a baglanmaz); o paketler degisse de bu goc ayni isi yapar.
const (
	addressIDsVersion = 1
	addressIDsName    = "adres-kimlikleri"
	// addressIDsPasses, eszamanli yazim yuzunden atlanan satirlar icin en fazla
	// tur. Acilista eski surumlu bir kopya hala yaziyorsa satir kayabilir.
	addressIDsPasses = 3
)

func addressIDs() Migration {
	return Migration{Version: addressIDsVersion, Name: addressIDsName, Up: addAddressIDs, Down: removeAddressIDs}
}

// withoutAddressID, kimliksiz en az bir adresi olan kullanicilar.
var withoutAddressID = bson.D{{Key: "addresses", Value: bson.D{{Key: "$elemMatch", Value: bson.D{
	{Key: "id", Value: bson.D{{Key: "$exists", Value: false}}},
}}}}}

// addAddressIDs, kimliksiz her adrese kimlik verir; kimligi olana DOKUNMAZ.
// Yeniden calistirilabilir: ikinci kosu bir sey yazmaz. Her satir kendi
// filtresiyle yazilir (sira + ad + kimliksiz): arada degisen defterde yanlis
// satira kimlik yazilmaz; atlanan satir bir sonraki turda yeniden denenir.
func addAddressIDs(ctx context.Context, db *mongo.Database) error {
	users := db.Collection("users")
	for range addressIDsPasses {
		remaining, err := users.CountDocuments(ctx, withoutAddressID)
		if err != nil {
			return fmt.Errorf("kimliksiz adresler sayilamadi: %w", err)
		}
		if remaining == 0 {
			return nil
		}
		if err := addressIDsPass(ctx, users); err != nil {
			return err
		}
	}
	remaining, err := users.CountDocuments(ctx, withoutAddressID)
	if err != nil {
		return fmt.Errorf("kimliksiz adresler sayilamadi: %w", err)
	}
	if remaining > 0 {
		return fmt.Errorf("%d kullanicinin adresi %d turda kimlik alamadi (defter es zamanli degisiyor)", remaining, addressIDsPasses)
	}
	return nil
}

func addressIDsPass(ctx context.Context, users *mongo.Collection) (err error) {
	cursor, err := users.Find(ctx, withoutAddressID, options.Find().SetProjection(bson.D{{Key: "addresses", Value: 1}}))
	if err != nil {
		return fmt.Errorf("kimliksiz adresler okunamadi: %w", err)
	}
	defer func() {
		if closeErr := cursor.Close(context.WithoutCancel(ctx)); closeErr != nil && err == nil {
			err = fmt.Errorf("imlec kapatilamadi: %w", closeErr)
		}
	}()
	for cursor.Next(ctx) {
		var user struct {
			ID        string   `bson:"_id"`
			Addresses []bson.M `bson:"addresses"`
		}
		if err := cursor.Decode(&user); err != nil {
			return fmt.Errorf("kullanici cozulemedi: %w", err)
		}
		for index, address := range user.Addresses {
			if _, has := address["id"]; has {
				continue
			}
			id, err := newAddressID()
			if err != nil {
				return err
			}
			path := "addresses." + strconv.Itoa(index)
			filter := bson.D{
				{Key: "_id", Value: user.ID},
				{Key: path + ".id", Value: bson.D{{Key: "$exists", Value: false}}},
				{Key: path + ".title", Value: address["title"]},
			}
			if _, err := users.UpdateOne(ctx, filter, bson.D{{Key: "$set", Value: bson.D{{Key: path + ".id", Value: id}}}}); err != nil {
				return fmt.Errorf("adres kimligi yazilamadi: %w", err)
			}
		}
	}
	if err := cursor.Err(); err != nil {
		return fmt.Errorf("kimliksiz adresler okunamadi: %w", err)
	}
	return nil
}

// removeAddressIDs, butun adreslerin kimligini siler (T11.15 oncesi sema).
// Yeniden calistirilabilir: kimligi kalmayan defterde bir sey yazmaz.
func removeAddressIDs(ctx context.Context, db *mongo.Database) error {
	_, err := db.Collection("users").UpdateMany(ctx,
		bson.D{{Key: "addresses.id", Value: bson.D{{Key: "$exists", Value: true}}}},
		bson.D{{Key: "$unset", Value: bson.D{{Key: "addresses.$[].id", Value: ""}}}})
	if err != nil {
		return fmt.Errorf("adres kimlikleri silinemedi: %w", err)
	}
	return nil
}

// newAddressID, "adr_" + 16 rastgele baytin onaltilik yazimi (donmus bicim).
func newAddressID() (string, error) {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("adres kimligi uretilemedi: %w", err)
	}
	return "adr_" + hex.EncodeToString(buffer), nil
}
