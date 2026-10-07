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
	// MarketList, market listesi ekrani (T11.12).
	MarketList MarketList `json:"marketList"`
	// Favorites, favori marketler (T11.13): kalp, favori sayfasi.
	Favorites Favorites `json:"favorites"`
	// AccountMenu, hesap menusu (T11.16): sol menu ve Profil acilir menusu.
	AccountMenu AccountMenu `json:"accountMenu"`
	// Profile, profil karti ve e-posta penceresi (T11.14).
	Profile Profile `json:"profile"`
	// Addresses, Adreslerim sekmesi (T11.15).
	Addresses Addresses `json:"addresses"`
	// Orders, Gecmis Siparislerim (T11.16).
	Orders Orders `json:"orders"`
	// PaymentMethods, Odeme Yontemlerim (T11.17).
	PaymentMethods PaymentMethods `json:"paymentMethods"`
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
