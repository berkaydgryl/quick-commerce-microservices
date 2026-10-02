package auth

import (
	"context"
	"errors"
	"time"
)

// Depo hatalari: depolar surucu hatasini bunlara cevirir; servis yalnizca
// bunlari tanir (Mongo'yu bilmez).
var (
	ErrPhoneTaken      = errors.New("telefon numarasi kayitli")
	ErrUserNotFound    = errors.New("kullanici bulunamadi")
	ErrSessionNotFound = errors.New("oturum bulunamadi ya da suresi dolmus")
	// ErrAddressTitleTaken, ayni adla kayitli adres var (T11.8; secici adla secer).
	ErrAddressTitleTaken = errors.New("bu adla kayitli adres var")
	// ErrAddressBookFull, adres defteri MaxSavedAddresses'a ulasti.
	ErrAddressBookFull = errors.New("adres defteri dolu")
)

// UserStore, kullanici kayitlari. Arayuz KULLANAN tarafta (servis) tanimlidir;
// gercegi authstore'da (Mongo ve bellek).
type UserStore interface {
	// Create, yeni kullaniciyi yazar; telefon kayitliysa ErrPhoneTaken.
	Create(ctx context.Context, user User) error
	// ByPhone, telefona gore kullanici; yoksa ErrUserNotFound.
	ByPhone(ctx context.Context, phone string) (User, error)
	// ByID, kimlige gore kullanici; yoksa ErrUserNotFound.
	ByID(ctx context.Context, id string) (User, error)
	// RecordLogin, girisi kullanici kaydina yazar ve ONCEKI durumu doner: son
	// giris IP'si her zaman, konum yalnizca biliniyorsa (nil degilse) guncellenir.
	// Tek atomik islemdir: es zamanli iki giris ayni "onceki IP"yi okumaz.
	// Kullanici yoksa ErrUserNotFound.
	RecordLogin(ctx context.Context, userID string, login LoginState) (LoginState, error)
	// CountByRegistrationDevice, cihazdan acilmis hesap sayisi.
	CountByRegistrationDevice(ctx context.Context, deviceID string) (int, error)
	// AddAddress, adresi adres defterinin sonuna ATOMIK ekler ve guncel
	// kullaniciyi doner (T11.8). Ayni adla adres varsa ErrAddressTitleTaken,
	// defterde max adres varsa ErrAddressBookFull, kullanici yoksa
	// ErrUserNotFound. Es zamanli iki ekleme siniri asamaz.
	AddAddress(ctx context.Context, userID string, address SavedAddress, max int) (User, error)
}

// SessionStore, oturum kayitlari.
type SessionStore interface {
	// Create, yeni oturumu yazar.
	Create(ctx context.Context, session Session) error
	// Rotate, ozeti oldHash olan ve suresi dolmamis oturumun jetonunu newHash
	// ile ATOMIK degistirir ve oturumu doner; yoksa ErrSessionNotFound. Ayni
	// eski jetonla gelen iki es zamanli yenilemeden YALNIZCA biri basarir.
	Rotate(ctx context.Context, oldHash, newHash string, now, expiresAt time.Time) (Session, error)
	// Revoke, ozeti verilen oturumu siler; silindiyse true.
	Revoke(ctx context.Context, tokenHash string) (bool, error)
	// ByID, kimlige gore oturum; yoksa ErrSessionNotFound. Suresi dolmus ama
	// TTL'in henuz silmedigi kaydi da doner: sureyi cagiran denetler.
	ByID(ctx context.Context, id string) (Session, error)
}
