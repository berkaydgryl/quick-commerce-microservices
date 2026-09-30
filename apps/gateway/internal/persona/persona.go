// Package persona, demo personalaridir (roadmap "Test personalari"; T8.1).
//
// Her risk bandi icin hazir bir hesap: Ayse (LOW), Zeynep (MEDIUM), Can (HIGH),
// Ali (CRITICAL: hesabinin acildigi cihazdan 4 hesap acilmis, kesin kural) ve
// Komsu (LOW; stok yarisinda ikinci tarayici). Ali'nin cihazindaki diger uc
// hesap da burada; secicide gorunmezler.
//
// Burada yalnizca gateway'in bildigi sinyaller durur: hesap yasi, hesabin
// acildigi cihaz ve son bilinen oturum konumu. Siparis gecmisi (teslim ve
// iptal sayilari, ortalama sepet) order-service'tedir: her servis kendi
// koleksiyonuna yazar (ADR-05). Iki taraf ayni kullanici kimliklerini kullanir;
// persona_test.go order-service'in dosyasiyla karsilastirir.
//
// Yalnizca yerel ve MOCK icindir: bilinen sifreli hesaplar production'a
// yazilmaz (Allowed). Demo sifresi herkese aciktir (gateway README); gizli
// degildir ve baska hicbir yerde kullanilmaz.
package persona

import (
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

//go:embed personas.json addresses.json
var files embed.FS

// productionEnv, NODE_ENV'in production degeri (config.EnvProduction ile ayni;
// config'e bagimlilik yalnizca bu sabit icin kurulmaz).
const productionEnv = "production"

// ErrProduction, production'da persona yukleme denemesi.
var ErrProduction = errors.New("personalar production ortaminda yuklenmez: bilinen sifreli hesaplar gercek veritabanina yazilmaz")

// Account, tek hesap.
type Account struct {
	// Persona, tablodaki ad ("Ayse", "Ali (2. hesap)").
	Persona string `json:"persona"`
	// Band, beklenen risk bandi; secicide gosterilir. Ek hesaplarda bos.
	Band                 string    `json:"band"`
	ID                   string    `json:"id"`
	Phone                string    `json:"phone"`
	FullName             string    `json:"fullName"`
	AgeHours             int       `json:"ageHours"`
	RegistrationDeviceID string    `json:"registrationDeviceId"`
	LastLocation         *geoPoint `json:"lastLocation"`
	// WithAddresses, hazir uc adres (Ev, Is, Yazlik) bu hesaba yuklensin mi.
	WithAddresses bool `json:"addresses"`
	// Selectable, giris ekranindaki persona secicide gorunur (T8.5).
	Selectable bool `json:"selectable"`
}

type geoPoint struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type address struct {
	Title    string   `json:"title"`
	Line     string   `json:"line"`
	Location geoPoint `json:"location"`
	Note     string   `json:"note"`
}

// Set, butun personalar, ortak demo sifresi ve hazir adresler.
type Set struct {
	Password  string
	Accounts  []Account
	Addresses []auth.SavedAddress
}

type personasFile struct {
	Password string    `json:"password"`
	Accounts []Account `json:"accounts"`
}

// Allowed, ortamda persona yuklenebilir mi? Production'da ErrProduction.
func Allowed(nodeEnv string) error {
	if nodeEnv == productionEnv {
		return ErrProduction
	}
	return nil
}

// Load, gomulu dosyalari cozer ve dogrular: kimlik ve cihaz bicimi, telefon ve
// sifre kurali (kayit ucunun kurali), tekrar eden kimlik ya da telefon.
func Load() (Set, error) {
	var people personasFile
	if err := decodeStrict("personas.json", &people); err != nil {
		return Set{}, err
	}
	var addresses []address
	if err := decodeStrict("addresses.json", &addresses); err != nil {
		return Set{}, err
	}
	set := Set{Password: people.Password, Accounts: people.Accounts}
	for _, item := range addresses {
		set.Addresses = append(set.Addresses, auth.SavedAddress{
			Title: item.Title, Line: item.Line, Location: auth.GeoPoint(item.Location), Note: item.Note,
		})
	}
	if err := set.validate(); err != nil {
		return Set{}, err
	}
	return set, nil
}

// Users, hesaplari kullanici kayitlarina cevirir. Hesap yasi now'a gorelidir:
// seed her calistiginda Zeynep ve Can yeniden "24 saatten yeni" olur.
// passwordHash, ortak demo sifresinin ozeti (hepsinde ayni; bir kez uretilir).
func (s Set) Users(now time.Time, passwordHash string) []auth.User {
	users := make([]auth.User, 0, len(s.Accounts))
	for _, account := range s.Accounts {
		user := auth.User{
			ID:                   account.ID,
			Phone:                account.Phone,
			PasswordHash:         passwordHash,
			FullName:             account.FullName,
			CreatedAt:            now.UTC().Add(-time.Duration(account.AgeHours) * time.Hour),
			RegistrationDeviceID: account.RegistrationDeviceID,
		}
		if account.LastLocation != nil {
			user.LastLocation = &auth.GeoPoint{Lat: account.LastLocation.Lat, Lng: account.LastLocation.Lng}
		}
		if account.WithAddresses {
			user.Addresses = append([]auth.SavedAddress(nil), s.Addresses...)
		}
		users = append(users, user)
	}
	return users
}

func (s Set) validate() error {
	var problems []error
	seenIDs, seenPhones := map[string]bool{}, map[string]bool{}
	for _, account := range s.Accounts {
		name := account.Persona
		if !ids.Valid(ids.User, account.ID) {
			problems = append(problems, fmt.Errorf("%s: kimlik usr_ + 32 hex olmali: %q", name, account.ID))
		}
		if !ids.Valid(ids.Device, account.RegistrationDeviceID) {
			problems = append(problems, fmt.Errorf("%s: cihaz dvc_ + 32 hex olmali: %q", name, account.RegistrationDeviceID))
		}
		for field, reason := range (auth.LoginInput{Phone: account.Phone, Password: s.Password}).Check() {
			problems = append(problems, fmt.Errorf("%s: %s %s", name, field, reason))
		}
		if seenIDs[account.ID] || seenPhones[account.Phone] {
			problems = append(problems, fmt.Errorf("%s: kimlik ya da telefon tekrar ediyor", name))
		}
		seenIDs[account.ID], seenPhones[account.Phone] = true, true
		if account.AgeHours <= 0 {
			problems = append(problems, fmt.Errorf("%s: hesap yasi pozitif olmali", name))
		}
	}
	if len(s.Addresses) == 0 {
		problems = append(problems, errors.New("hazir adres yok"))
	}
	// Adres defteri sinirlidir (auth.MaxSavedAddresses): seed siniri asan
	// defteri yazmaz, okuma kesmesi sessiz veri kaybina donusmesin.
	if len(s.Addresses) > auth.MaxSavedAddresses {
		problems = append(problems, fmt.Errorf("hazir adres en fazla %d olmali: %d", auth.MaxSavedAddresses, len(s.Addresses)))
	}
	return errors.Join(problems...)
}

// decodeStrict, gomulu dosyayi bilinmeyen alana izin vermeden cozer: yanlis
// yazilmis bir alan (ornek "lastLocaton") sessizce yok sayilmasin.
func decodeStrict(name string, target any) error {
	raw, err := files.ReadFile(name)
	if err != nil {
		return fmt.Errorf("%s okunamadi: %w", name, err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("%s cozulemedi: %w", name, err)
	}
	return nil
}
