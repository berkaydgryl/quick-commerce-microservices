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

import "context"

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
)

// Welcome, oturumsuz ziyaretcinin karsilama ekrani. JSON adlari sozlesmeyle
// birebir aynidir.
type Welcome struct {
	Header     Header           `json:"header"`
	Hero       Hero             `json:"hero"`
	LoginCard  LoginCard        `json:"loginCard"`
	Categories CategoriesHeader `json:"categories"`
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

// LoginCard, giris karti: telefon adimi, sifre ve kayit adimlari.
type LoginCard struct {
	Title             string         `json:"title"`
	CountryLabel      string         `json:"countryLabel"`
	PhoneLabel        string         `json:"phoneLabel"`
	PhonePlaceholder  string         `json:"phonePlaceholder"`
	ContinueLabel     string         `json:"continueLabel"`
	EditPhoneLabel    string         `json:"editPhoneLabel"`
	ShowPasswordLabel string         `json:"showPasswordLabel"`
	Countries         []PhoneCountry `json:"countries"`
	Login             LoginStep      `json:"login"`
	Register          RegisterStep   `json:"register"`
}

// PhoneCountry, ulke kodu secicisinin bir satiri. FlagURL dosyada goreli yol.
type PhoneCountry struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	DialCode string `json:"dialCode"`
	FlagURL  string `json:"flagUrl"`
}

// LoginStep, sifre adimi (kayitli kullanici).
type LoginStep struct {
	PasswordLabel     string `json:"passwordLabel"`
	SubmitLabel       string `json:"submitLabel"`
	PendingLabel      string `json:"pendingLabel"`
	RegisterPrompt    string `json:"registerPrompt"`
	RegisterLinkLabel string `json:"registerLinkLabel"`
}

// RegisterStep, kayit adimi (ad soyad ve sifre).
type RegisterStep struct {
	FullNameLabel  string `json:"fullNameLabel"`
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
