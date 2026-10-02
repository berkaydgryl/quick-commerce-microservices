package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

// User, kullanici kaydi (users koleksiyonu; sahibi gateway, ADR-05).
type User struct {
	ID           string
	Phone        string
	PasswordHash string
	FullName     string
	CreatedAt    time.Time
	// RegistrationDeviceID, hesabin acildigi cihaz (cihaz cerezi). "Ayni
	// cihazdan acilmis hesap sayisi" risk sinyali bununla sayilir. Bu ozellikten
	// (T8.1) once acilmis hesapta bostur: sinyal olculmemis sayilir.
	RegistrationDeviceID string
	// LastLoginIP, son girisin IP'si; bir sonraki giriste "onceki IP" olur.
	LastLoginIP string
	// LastLocation, son bilinen oturum konumu. IP bir konuma cozulemezse yeni
	// oturum bunu devralir; hic bilinmiyorsa nil.
	LastLocation *GeoPoint
	// Addresses, kayitli adresler (adres defteri), en fazla MaxSavedAddresses.
	// Demo adresleri persona seed'iyle gelir; GET /v1/me/addresses okur (T9.5).
	Addresses []SavedAddress
}

// GeoPoint, enlem ve boylam (derece).
type GeoPoint struct {
	Lat float64
	Lng float64
}

// SavedAddress, kayitli adres (@getir/contracts savedAddressSchema). Kind,
// Building, Floor ve Apartment T11.8'de eklendi: persona seed'inin
// adreslerinde bostur.
type SavedAddress struct {
	Title     string
	Kind      string
	Line      string
	Location  GeoPoint
	Building  string
	Floor     string
	Apartment string
	Note      string
}

// Profile, istemciye giden kullanici (@getir/contracts userProfileSchema).
// Sifre ozeti gibi alanlar BILEREK yoktur: tip, sizintiyi derleme aninda onler.
type Profile struct {
	ID       string `json:"id"`
	Phone    string `json:"phone"`
	FullName string `json:"fullName"`
}

// Profile, kaydin istemciye gidebilen kismi.
func (u User) Profile() Profile {
	return Profile{ID: u.ID, Phone: u.Phone, FullName: u.FullName}
}

// MaxSavedAddresses, adres defterinin ust siniri (@getir/contracts
// SAVED_ADDRESSES_MAX; rules_contract_test esitligini denetler).
//
// Adres defteri kullanicinin urettigi bir listedir; sayfalanmaz, SINIRLIDIR
// (proje kurallari, "Sinirli listeler istisnasi"): yazan her yol siniri asan
// kaydi reddeder (persona seed'i; ileride adres ekleme ucu), okuma da siniri
// uygular. Demoda 3 adres var; 10, bir kisinin adres defteri icin cok genis.
const MaxSavedAddresses = 10

// AddressBook, istemciye giden adres defteri (@getir/contracts
// savedAddressListSchema). Bos defter JSON'da [] olur, null DEGIL.
type AddressBook struct {
	Items []AddressEntry `json:"items"`
}

// AddressEntry, istemciye giden kayitli adres (@getir/contracts savedAddressSchema).
// Istege bagli alanlar bossa hic yazilmaz.
type AddressEntry struct {
	Title     string        `json:"title"`
	Kind      string        `json:"kind,omitempty"`
	Line      string        `json:"line"`
	Location  rest.GeoPoint `json:"location"`
	Building  string        `json:"building,omitempty"`
	Floor     string        `json:"floor,omitempty"`
	Apartment string        `json:"apartment,omitempty"`
	Note      string        `json:"note,omitempty"`
}

// AddressBook, kaydin adres defteri: kayit sirasinda, en fazla MaxSavedAddresses.
func (u User) AddressBook() AddressBook {
	addresses := u.Addresses
	if len(addresses) > MaxSavedAddresses {
		addresses = addresses[:MaxSavedAddresses]
	}
	items := make([]AddressEntry, 0, len(addresses))
	for _, address := range addresses {
		items = append(items, AddressEntry{
			Title:     address.Title,
			Kind:      address.Kind,
			Line:      address.Line,
			Location:  rest.GeoPoint{Lat: address.Location.Lat, Lng: address.Location.Lng},
			Building:  address.Building,
			Floor:     address.Floor,
			Apartment: address.Apartment,
			Note:      address.Note,
		})
	}
	return AddressBook{Items: items}
}

// Session, bir girisin sunucudaki kaydi (sessions koleksiyonu).
//
// Yenileme jetonunun KENDISI saklanmaz, yalnizca ozeti (SHA-256): veritabani
// sizsa bile kayitlardan kullanilabilir jeton cikmaz. Jeton 32 rastgele bayttir;
// bu entropide yavas bir ozet (bcrypt) gerekmez.
type Session struct {
	ID          string
	UserID      string
	TokenHash   string
	CreatedAt   time.Time
	RefreshedAt time.Time
	ExpiresAt   time.Time
	// IPAddress, girisin yapildigi baglantinin IP'si (B9: istemciden alinmaz).
	IPAddress string
	// DeviceID, oturumun acildigi cihaz (cihaz cerezi).
	DeviceID string
	// PreviousIPAddress, kullanicinin bir onceki girisinin IP'si ("IP
	// degisimi" sinyali); ilk oturumda bos.
	PreviousIPAddress string
	// IPCity, girisin IP'sinden cozulen sehir; cozulemediyse bos.
	IPCity string
	// Location, oturumun konumu (geofence): IP'den cozulen ya da kullanicinin
	// son bilinen konumu; hic bilinmiyorsa nil.
	Location *GeoPoint
}

// refreshTokenBytes, yenileme jetonunun rastgele bayt sayisi (256 bit).
const refreshTokenBytes = 32

// newRefreshToken, opak yenileme jetonu: URL'de guvenli base64 (43 karakter).
func newRefreshToken() string {
	return base64.RawURLEncoding.EncodeToString(ids.RandomBytes(refreshTokenBytes))
}

// HashRefreshToken, jetonun saklanan ozeti. Depolar ve servis ayni ozeti kullanir.
func HashRefreshToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Grant, basarili kayit, giris ya da yenilemenin sonucu
// (@getir/contracts authSessionSchema).
type Grant struct {
	AccessToken string `json:"accessToken"`
	TokenType   string `json:"tokenType"`
	ExpiresIn   int64  `json:"expiresIn"`
	// RefreshToken govdeye GIRMEZ: httpapi onu HttpOnly cereze yazar
	// (getir_refresh). Sayfadaki betik okuyamaz; XSS 14 gunluk jetonu calamaz.
	RefreshToken     string  `json:"-"`
	RefreshExpiresIn int64   `json:"refreshExpiresIn"`
	User             Profile `json:"user"`
}

// tokenTypeBearer, tek desteklenen jeton turu.
const tokenTypeBearer = "Bearer"

// RequestMeta, istegin SUNUCU tarafi bilgisi (B9: risk sinyalleri istemciden
// alinmaz).
type RequestMeta struct {
	// IPAddress, baglantinin IP'si (istemcinin yazabildigi bir basliktan degil).
	IPAddress string
	// DeviceID, gateway'in verdigi cihaz cerezi (dvc_...). Cerez yoksa ya da
	// bicim disiysa httpapi yenisini uretir; burada her zaman gecerlidir.
	DeviceID string
}

// LoginState, kullanicinin giris kaydi: son girisin IP'si ve son bilinen
// oturum konumu. Giris bunu gunceller; onceki degeri oturuma "onceki IP"
// olarak yazilir.
type LoginState struct {
	IPAddress string
	Location  *GeoPoint
}

// CheckoutSignals, siparis aninda risk-svc'ye giden ve gateway'in bildigi
// sinyaller (proto order.v1.CheckoutSignals; B9). Bos alan "bilinmiyor"
// demektir ve ilgili kurali tetiklemez (risk sozlesmesi).
type CheckoutSignals struct {
	IPAddress string
	// IPCity, oturumun IP'sinden cozulen sehir; cozulemediyse bos.
	IPCity   string
	DeviceID string
	// AccountsOnDevice, hesabin acildigi cihazdan acilmis hesap sayisi; 0 =
	// olculmedi (cihazi bilinmeyen eski hesap).
	AccountsOnDevice  int
	PreviousIPAddress string
	// SessionLocation, oturumun konumu; bilinmiyorsa nil.
	SessionLocation  *GeoPoint
	AccountCreatedAt time.Time
}
