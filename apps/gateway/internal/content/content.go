// Package content, ekran iceriginin (metin ve gorsel) gateway tarafidir (T11.6).
//
// NEDEN VAR: karsilama ekraninin hicbir metni ya da gorseli web kodunda sabit
// yazilmaz; GET /v1/content/welcome ile gelir. Projede CMS yoktur; bugun
// kaynak bu pakete gomulu welcome.json dosyasidir. Bir CMS baglaninca uc ve
// sozlesme (@getir/contracts welcomeContentSchema) degismez, yalnizca kaynak
// degisir: Static yerine ayni metodu karsilayan baska bir kaynak yazilir.
//
// Dosya acilista bir kez okunur, dogrulanir ve gorsel yollari mutlak adrese
// cevrilir (load.go, validate.go). Hatali icerik servisi ACMAZ: bozuk metin
// ya da gorsel istemcide sessizce bos bir ekran olurdu.
package content

import (
	"context"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

// Sozlesme sinirlari (@getir/contracts constants.ts; esitligi
// contract_test.go denetler).
const (
	// MaxTextLength, bir metnin en uzun hali (UTF-16 birimi; Zod'un max'i
	// JavaScript uzunlugunu sayar).
	MaxTextLength = 200
	// MaxBannerSources, banner gorselinin en fazla boy sayisi (srcset).
	MaxBannerSources = 4
	// MaxPhoneCountries, ulke kodu secicisinin en fazla satiri.
	MaxPhoneCountries = 10
	// MaxStoreLinks, uygulama indirme bandindaki en fazla magaza rozeti (T11.7).
	MaxStoreLinks = 4
	// MaxFeatures, en fazla tanitim kutusu (T11.7).
	MaxFeatures = 6
	// MinMapZoom ve MaxMapZoom, adres haritasinin baslangic yakinlastirmasi (T11.8).
	MinMapZoom = 1
	MaxMapZoom = 19
)

// Welcome, oturumsuz ziyaretcinin karsilama ekrani. JSON adlari sozlesmeyle
// birebir aynidir.
type Welcome struct {
	Header     Header           `json:"header"`
	Hero       Hero             `json:"hero"`
	LoginCard  LoginCard        `json:"loginCard"`
	Categories CategoriesHeader `json:"categories"`
	// AppDownload ve Features, kategorilerin altindaki tanitim bolumleri (T11.7).
	AppDownload AppDownload `json:"appDownload"`
	Features    []Feature   `json:"features"`
	// AddressSetup, oturum acik ama adres yoksa acilan pencere (T11.8).
	AddressSetup AddressSetup `json:"addressSetup"`
	// AppHeader, oturumlu sayfalarin ust bari (T11.10).
	AppHeader AppHeader `json:"appHeader"`
}

// Header, ust bar: logonun iki parcasi ve iki dugme.
type Header struct {
	Brand         string `json:"brand"`
	Service       string `json:"service"`
	LoginLabel    string `json:"loginLabel"`
	RegisterLabel string `json:"registerLabel"`
}

// Hero, banner katmani. Title sayfanin h1'i ve banner'in alt metnidir:
// slogan gorselin icinde yazilidir.
type Hero struct {
	Title  string `json:"title"`
	Banner Banner `json:"banner"`
}

// Banner, ayni gorselin boylari ve dogal boyutu (oran icin).
type Banner struct {
	Sources []BannerSource `json:"sources"`
	Width   int            `json:"width"`
	Height  int            `json:"height"`
}

// BannerSource, banner'in bir boyu. URL dosyada GORELI yoldur, cevapta
// mutlak adres (assets.Resolver).
type BannerSource struct {
	URL   string `json:"url"`
	Width int    `json:"width"`
}

// LoginCard, karsilama karti ile giris ve kayit penceresinin metinleri.
type LoginCard struct {
	Title             string         `json:"title"`
	CountryLabel      string         `json:"countryLabel"`
	PhoneLabel        string         `json:"phoneLabel"`
	PhonePlaceholder  string         `json:"phonePlaceholder"`
	ContinueLabel     string         `json:"continueLabel"`
	CloseLabel        string         `json:"closeLabel"`
	ShowPasswordLabel string         `json:"showPasswordLabel"`
	Countries         []PhoneCountry `json:"countries"`
	// ForgotPasswordLabel, karttaki ve giris penceresindeki "Sifremi unuttum" (T11.9).
	ForgotPasswordLabel string            `json:"forgotPasswordLabel"`
	Login               LoginStep         `json:"login"`
	Register            RegisterStep      `json:"register"`
	ResetPassword       ResetPasswordStep `json:"resetPassword"`
}

// PhoneCountry, ulke kodu secicisinin bir satiri. FlagURL dosyada goreli yol.
type PhoneCountry struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	DialCode string `json:"dialCode"`
	FlagURL  string `json:"flagUrl"`
}

// LoginStep, giris penceresi (kayitli kullanici).
type LoginStep struct {
	PasswordLabel     string `json:"passwordLabel"`
	SubmitLabel       string `json:"submitLabel"`
	PendingLabel      string `json:"pendingLabel"`
	RegisterPrompt    string `json:"registerPrompt"`
	RegisterLinkLabel string `json:"registerLinkLabel"`
	// UnknownPhoneNotice, kayitsiz numara yazilinca telefonun altindaki uyari (T11.7).
	UnknownPhoneNotice string `json:"unknownPhoneNotice"`
}

// RegisterStep, kayit penceresi (ad soyad, telefon, sifre).
type RegisterStep struct {
	FullNameLabel  string `json:"fullNameLabel"`
	PasswordLabel  string `json:"passwordLabel"`
	SubmitLabel    string `json:"submitLabel"`
	PendingLabel   string `json:"pendingLabel"`
	LoginPrompt    string `json:"loginPrompt"`
	LoginLinkLabel string `json:"loginLinkLabel"`
	// KnownPhoneNotice, kayitli numara yazilinca telefonun altindaki uyari (T11.7).
	KnownPhoneNotice string `json:"knownPhoneNotice"`
}

// ResetPasswordStep, sifre yenileme penceresi (T11.9): telefon ve yeni sifre.
type ResetPasswordStep struct {
	Title          string `json:"title"`
	Description    string `json:"description"`
	PasswordLabel  string `json:"passwordLabel"`
	SubmitLabel    string `json:"submitLabel"`
	PendingLabel   string `json:"pendingLabel"`
	LoginPrompt    string `json:"loginPrompt"`
	LoginLinkLabel string `json:"loginLinkLabel"`
}

// CategoriesHeader, kategori bolumunun basligi; liste /v1/categories'ten gelir.
type CategoriesHeader struct {
	Title string `json:"title"`
}

// Image, tek boy bir gorsel: adres ve dogal boyut. URL dosyada goreli yol,
// cevapta mutlak adres (assets.Resolver).
type Image struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// StoreLink, magaza rozeti. URL disari giden https baglantisidir; gateway
// cozmez, oldugu gibi tasir. Rozet gorseli goreli yoldur.
type StoreLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
	Badge Image  `json:"badge"`
}

// AppDownload, uygulama indirme bandi (T11.7).
type AppDownload struct {
	Title    string      `json:"title"`
	Subtitle string      `json:"subtitle"`
	Image    Image       `json:"image"`
	Stores   []StoreLink `json:"stores"`
}

// Feature, tanitim kutusu (T11.7): gorsel + metin.
type Feature struct {
	Image Image  `json:"image"`
	Text  string `json:"text"`
}

// AddressSetup, adres ekleme penceresi (T11.8): 1. adim harita + arama,
// 2. adim detay formu. Form kurallari ve hata cumleleri burada degil,
// sozlesmede ve auth paketindedir.
type AddressSetup struct {
	Title             string `json:"title"`
	BackLabel         string `json:"backLabel"`
	PinHint           string `json:"pinHint"`
	SearchLabel       string `json:"searchLabel"`
	SearchPlaceholder string `json:"searchPlaceholder"`
	SearchSubmitLabel string `json:"searchSubmitLabel"`
	SearchEmptyNotice string `json:"searchEmptyNotice"`
	UseAddressLabel   string `json:"useAddressLabel"`
	ResolvingLabel    string `json:"resolvingLabel"`
	UnresolvedNotice  string `json:"unresolvedNotice"`
	KindLabel         string `json:"kindLabel"`
	// Kinds, adres turu secicisinin satirlari (Ev, Is, Diger).
	Kinds          []AddressKindOption `json:"kinds"`
	TitleLabel     string              `json:"titleLabel"`
	LineLabel      string              `json:"lineLabel"`
	BuildingLabel  string              `json:"buildingLabel"`
	FloorLabel     string              `json:"floorLabel"`
	ApartmentLabel string              `json:"apartmentLabel"`
	NoteLabel      string              `json:"noteLabel"`
	SaveLabel      string              `json:"saveLabel"`
	SavingLabel    string              `json:"savingLabel"`
	NoMarketNotice string              `json:"noMarketNotice"`
	Map            Map                 `json:"map"`
}

// AppHeader, uygulamanin ust bari (T11.10): logo | arama kutusu (icinde
// teslimat adresi) | Profil. Yalnizca metinler; kural yok.
type AppHeader struct {
	SearchLabel       string `json:"searchLabel"`
	SearchPlaceholder string `json:"searchPlaceholder"`
	SearchClearLabel  string `json:"searchClearLabel"`
	AddressLabel      string `json:"addressLabel"`
	AddressListLabel  string `json:"addressListLabel"`
	// Adreslerim penceresi: baslik, onay dugmesi, alt bant (Adres Ekle).
	AddressBookTitle    string `json:"addressBookTitle"`
	AddressConfirmLabel string `json:"addressConfirmLabel"`
	AddressAddPrompt    string `json:"addressAddPrompt"`
	AddressAddLabel     string `json:"addressAddLabel"`
	AddressLoginLabel   string `json:"addressLoginLabel"`
	NoAddressNotice     string `json:"noAddressNotice"`
	AddressLoadingLabel string `json:"addressLoadingLabel"`
	ProfileLabel        string `json:"profileLabel"`
	AccountLabel        string `json:"accountLabel"`
	LogoutLabel         string `json:"logoutLabel"`
	LogoutPendingLabel  string `json:"logoutPendingLabel"`
}

// AddressKindOption, adres turu: sozlesmedeki tur ("HOME"), etiket ve ikon (emoji).
type AddressKindOption struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Icon  string `json:"icon"`
}

// Map, adres haritasi: karo adresi ({z}/{x}/{y}), atif (OSM lisansi geregi
// haritada gorunur), baslangic noktasi ve yakinlastirma. Karo adresi disari
// gider; gateway cozmez, oldugu gibi tasir.
type Map struct {
	TileURL     string        `json:"tileUrl"`
	Attribution string        `json:"attribution"`
	Center      rest.GeoPoint `json:"center"`
	Zoom        int           `json:"zoom"`
}

// Static, acilista yuklenmis icerigi bellekten veren kaynak.
type Static struct {
	welcome Welcome
}

// NewStatic, yuklenmis (dogrulanmis, gorselleri cozulmus) icerikle kaynagi kurar.
func NewStatic(welcome Welcome) *Static {
	return &Static{welcome: welcome}
}

// Welcome, karsilama icerigini dondurur. Bellekten okur; baglam, ayni
// arayuzu karsilayacak bir CMS kaynaginin ag cagrisi icindir. Cagiran donen
// degeri yalnizca okur (dilimler paylasilir).
func (s *Static) Welcome(_ context.Context) (Welcome, error) {
	return s.welcome, nil
}
