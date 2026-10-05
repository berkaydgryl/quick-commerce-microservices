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
	// MarketList, market listesi ekrani (T11.12).
	MarketList MarketList `json:"marketList"`
	// Favorites, favori marketler (T11.13): kalp, profil menusu, favori sayfasi.
	Favorites Favorites `json:"favorites"`
	// Profile, profil karti ve e-posta penceresi (T11.14).
	Profile Profile `json:"profile"`
	// Addresses, Adreslerim sekmesi (T11.15).
	Addresses Addresses `json:"addresses"`
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
	// FavoritesLabel, Profil menusunun favori sayfasi baglantisi (T11.13).
	FavoritesLabel     string `json:"favoritesLabel"`
	LogoutLabel        string `json:"logoutLabel"`
	LogoutPendingLabel string `json:"logoutPendingLabel"`
}

// MarketList, market listesi ekrani (T11.12; referans getircarsi): solda
// gruplu dukkan turleri, ortada market kartlari, sagda Sepetim. Hangi turun
// hangi grupta oldugu buradan gelir; kural validate.go'dadir. Para ve sure
// bicimi istemcidedir: burada yalnizca etiketler.
type MarketList struct {
	CategoriesTitle            string           `json:"categoriesTitle"`
	AllLabel                   string           `json:"allLabel"`
	CountLabel                 string           `json:"countLabel"`
	ClearFilterLabel           string           `json:"clearFilterLabel"`
	LoadingLabel               string           `json:"loadingLabel"`
	EmptyNotice                string           `json:"emptyNotice"`
	FilterEmptyNotice          string           `json:"filterEmptyNotice"`
	RatingLabel                string           `json:"ratingLabel"`
	RatingCountLabel           string           `json:"ratingCountLabel"`
	MinBasketLabel             string           `json:"minBasketLabel"`
	FreeDeliveryThresholdLabel string           `json:"freeDeliveryThresholdLabel"`
	ClosedLabel                string           `json:"closedLabel"`
	StoreTypes                 []StoreTypeLabel `json:"storeTypes"`
	Groups                     []StoreTypeGroup `json:"groups"`
	Cart                       MarketListCart   `json:"cart"`
}

// Favorites, favori marketlerin metinleri (T11.13; referans getircarsi
// "Favori Isletmelerim"): kalbin erisilebilir adlari, favori sayfasi, hata
// bildirimleri ve profil sayfasinin menusu. Yalnizca metin; kural yok.
type Favorites struct {
	Title              string `json:"title"`
	AddLabel           string `json:"addLabel"`
	RemoveLabel        string `json:"removeLabel"`
	LoadingLabel       string `json:"loadingLabel"`
	EmptyTitle         string `json:"emptyTitle"`
	EmptyHint          string `json:"emptyHint"`
	RemovedNotice      string `json:"removedNotice"`
	UpdateFailedToast  string `json:"updateFailedToast"`
	ListFullToast      string `json:"listFullToast"`
	ToastDismissLabel  string `json:"toastDismissLabel"`
	ProfileMenuLabel   string `json:"profileMenuLabel"`
	AddressesLabel     string `json:"addressesLabel"`
	FavoritesMenuLabel string `json:"favoritesMenuLabel"`
}

// Profile, profil kartinin metinleri (T11.14; PR 2'de Hesabim paneli kalkti,
// PR 3'te "Profili düzenle" ve telefon adimi geldi): e-posta ve telefon
// satirlari, kalem ve pencereler. Yalnizca metin; kod kurallari (sure, deneme)
// verification'da.
type Profile struct {
	PhoneLabel       string            `json:"phoneLabel"`
	EmailLabel       string            `json:"emailLabel"`
	AddEmailLabel    string            `json:"addEmailLabel"`
	EditProfileLabel string            `json:"editProfileLabel"`
	VerifiedLabel    string            `json:"verifiedLabel"`
	VerifyPhoneLabel string            `json:"verifyPhoneLabel"`
	LoadingLabel     string            `json:"loadingLabel"`
	EditDialog       EditProfileDialog `json:"editDialog"`
	EmailDialog      EmailDialog       `json:"emailDialog"`
	PhoneDialog      PhoneDialog       `json:"phoneDialog"`
}

// EditProfileDialog, "Profili düzenle" penceresinin genel gorunumu: ad, e-posta
// ve telefon satirlari.
type EditProfileDialog struct {
	Title           string `json:"title"`
	CloseLabel      string `json:"closeLabel"`
	BackLabel       string `json:"backLabel"`
	NameLabel       string `json:"nameLabel"`
	SaveNameLabel   string `json:"saveNameLabel"`
	SavingNameLabel string `json:"savingNameLabel"`
	NameSavedToast  string `json:"nameSavedToast"`
	EmailLabel      string `json:"emailLabel"`
	PhoneLabel      string `json:"phoneLabel"`
	EmptyEmailLabel string `json:"emptyEmailLabel"`
	ChangeLabel     string `json:"changeLabel"`
	AddLabel        string `json:"addLabel"`
	VerifyLabel     string `json:"verifyLabel"`
}

// PhoneDialog, telefon adimi: numara degistirme ya da dogrulama ve kod adimi.
type PhoneDialog struct {
	Title             string `json:"title"`
	ChangeDescription string `json:"changeDescription"`
	VerifyDescription string `json:"verifyDescription"`
	PhoneFieldLabel   string `json:"phoneFieldLabel"`
	PasswordLabel     string `json:"passwordLabel"`
	ShowPasswordLabel string `json:"showPasswordLabel"`
	SendLabel         string `json:"sendLabel"`
	SendingLabel      string `json:"sendingLabel"`
	CodeSentToLabel   string `json:"codeSentToLabel"`
	CodeFieldLabel    string `json:"codeFieldLabel"`
	VerifyLabel       string `json:"verifyLabel"`
	VerifyingLabel    string `json:"verifyingLabel"`
	ExpiresInLabel    string `json:"expiresInLabel"`
	ExpiredNotice     string `json:"expiredNotice"`
	ResendLabel       string `json:"resendLabel"`
	ResendWaitLabel   string `json:"resendWaitLabel"`
	ChangePhoneLabel  string `json:"changePhoneLabel"`
	VerifiedToast     string `json:"verifiedToast"`
	ChangedToast      string `json:"changedToast"`
}

// EmailDialog, e-posta penceresi: adres adimi ve kod adimi.
type EmailDialog struct {
	Title            string `json:"title"`
	CloseLabel       string `json:"closeLabel"`
	EmailDescription string `json:"emailDescription"`
	EmailFieldLabel  string `json:"emailFieldLabel"`
	SendLabel        string `json:"sendLabel"`
	SendingLabel     string `json:"sendingLabel"`
	CodeSentToLabel  string `json:"codeSentToLabel"`
	CodeFieldLabel   string `json:"codeFieldLabel"`
	VerifyLabel      string `json:"verifyLabel"`
	VerifyingLabel   string `json:"verifyingLabel"`
	ExpiresInLabel   string `json:"expiresInLabel"`
	ExpiredNotice    string `json:"expiredNotice"`
	ResendLabel      string `json:"resendLabel"`
	ResendWaitLabel  string `json:"resendWaitLabel"`
	ChangeEmailLabel string `json:"changeEmailLabel"`
	VerifiedToast    string `json:"verifiedToast"`
}

// StoreTypeLabel, dukkan turunun adi: sozlesmedeki tur ("KASAP") ve etiket.
type StoreTypeLabel struct {
	Type  string `json:"type"`
	Label string `json:"label"`
}

// StoreTypeGroup, sol menunun akordeon grubu: ad, satirdaki kucuk gorsel
// (dosyada GORELI yol, cevapta mutlak adres) ve gruptaki turler.
type StoreTypeGroup struct {
	Label    string   `json:"label"`
	ImageURL string   `json:"imageUrl"`
	Types    []string `json:"types"`
}

// MarketListCart, Sepetim paneli ve telefondaki sepet cubugu.
type MarketListCart struct {
	Title                   string `json:"title"`
	EmptyTitle              string `json:"emptyTitle"`
	EmptyHint               string `json:"emptyHint"`
	ItemCountLabel          string `json:"itemCountLabel"`
	SubtotalLabel           string `json:"subtotalLabel"`
	DeliveryLabel           string `json:"deliveryLabel"`
	FreeDeliveryLabel       string `json:"freeDeliveryLabel"`
	TotalLabel              string `json:"totalLabel"`
	MinBasketRemainingLabel string `json:"minBasketRemainingLabel"`
	GoToCartLabel           string `json:"goToCartLabel"`
	ClearLabel              string `json:"clearLabel"`
}

// Addresses, Adreslerim sekmesinin metinleri (T11.15; /hesabim/adreslerim):
// liste, satir eylemleri, ekleme satirlari, duzenleme penceresi ve silme
// onayi. *Suffix alanlari adin arkasina eklenir ("Ev adresini düzenle").
// Yalnizca metin; kural yok.
type Addresses struct {
	Title                 string             `json:"title"`
	LoadingLabel          string             `json:"loadingLabel"`
	EmptyNotice           string             `json:"emptyNotice"`
	SelectedLabel         string             `json:"selectedLabel"`
	EditSuffix            string             `json:"editSuffix"`
	DeleteSuffix          string             `json:"deleteSuffix"`
	AddOptions            []AddressAddOption `json:"addOptions"`
	EditTitle             string             `json:"editTitle"`
	DeleteLabel           string             `json:"deleteLabel"`
	ConfirmTitle          string             `json:"confirmTitle"`
	ConfirmQuestionSuffix string             `json:"confirmQuestionSuffix"`
	ConfirmHint           string             `json:"confirmHint"`
	ConfirmLabel          string             `json:"confirmLabel"`
	DeletingLabel         string             `json:"deletingLabel"`
	CancelLabel           string             `json:"cancelLabel"`
	DeletedToastSuffix    string             `json:"deletedToastSuffix"`
	UpdatedToast          string             `json:"updatedToast"`
}

// AddressAddOption, Adreslerim'in ekleme satiri: tur ve metni ("Ev adresi ekle").
type AddressAddOption struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
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
