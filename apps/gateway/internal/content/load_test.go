package content

import (
	"net/url"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/assets"
)

const testAssetBase = "https://cdn.example.com/static"

func testResolver(t *testing.T) assets.Resolver {
	t.Helper()
	base, err := url.Parse(testAssetBase)
	if err != nil {
		t.Fatalf("kok adres cozulemedi: %v", err)
	}
	return assets.NewResolver(base)
}

// validJSON, en kucuk gecerli icerik; testler ondan bozuk surumler uretir.
const validJSON = `{
  "header": {"brand": "getir", "service": "market", "loginLabel": "Giriş yap", "registerLabel": "Kayıt ol"},
  "hero": {
    "title": "Kapına gelen market",
    "banner": {"sources": [{"url": "/img/banner/a-960.jpg", "width": 960}], "width": 960, "height": 277}
  },
  "loginCard": {
    "title": "Giriş yap veya kayıt ol", "countryLabel": "Ülke kodu", "phoneLabel": "Telefon numarası",
    "phonePlaceholder": "5XX XXX XX XX", "continueLabel": "Devam Et", "closeLabel": "Kapat",
    "showPasswordLabel": "Şifreyi göster",
    "countries": [{"code": "TR", "name": "Türkiye", "dialCode": "+90", "flagUrl": "/img/flag/tr.svg"}],
    "login": {"passwordLabel": "Şifren", "submitLabel": "Giriş yap", "pendingLabel": "Giriş yapılıyor…",
      "registerPrompt": "Hesabın yok mu?", "registerLinkLabel": "Kayıt ol",
      "unknownPhoneNotice": "Bu numarayla kayıtlı bir hesap yok."},
    "register": {"fullNameLabel": "Adın soyadın", "passwordLabel": "Şifre belirle", "submitLabel": "Kayıt ol",
      "pendingLabel": "Kaydın yapılıyor…", "loginPrompt": "Zaten hesabın var mı?", "loginLinkLabel": "Giriş yap",
      "knownPhoneNotice": "Bu numarayla kayıtlı bir hesap var."}
  },
  "categories": {"title": "Kategoriler"},
  "appDownload": {
    "title": "Getir'i indir!", "subtitle": "İstediğin ürünleri dakikalar içinde kapına getirelim.",
    "image": {"url": "/img/landing/telefonlar.png", "width": 634, "height": 298},
    "stores": [{"label": "App Store'dan indir", "url": "https://apps.apple.com/app/id995280265",
      "badge": {"url": "/img/store/app-store.svg", "width": 160, "height": 48}}]
  },
  "features": [{"image": {"url": "/img/tanitim/teslimat.png", "width": 300, "height": 300}, "text": "Dakikalar içinde kapında!"}],
  "addressSetup": {
    "title": "Teslimat Adresi Ekle", "backLabel": "Geri", "pinHint": "Adresini seçmek için Pin'i sürükle",
    "searchLabel": "Adres ara", "searchPlaceholder": "Sokağını veya posta kodunu arat", "searchSubmitLabel": "Ara",
    "searchEmptyNotice": "Sonuç bulunamadı.", "useAddressLabel": "Bu adresi kullan", "resolvingLabel": "Adres bulunuyor…",
    "unresolvedNotice": "Bu nokta için adres bulunamadı.", "kindLabel": "Adres türü",
    "kinds": [{"kind": "HOME", "label": "Ev", "icon": "🏠"}, {"kind": "WORK", "label": "İş", "icon": "🏢"}],
    "titleLabel": "Başlık", "lineLabel": "Adres", "buildingLabel": "Bina", "floorLabel": "Kat", "apartmentLabel": "Daire",
    "noteLabel": "Adres Tarifi", "saveLabel": "Kaydet", "savingLabel": "Kaydediliyor…", "noMarketNotice": "Hizmet veren market yok.",
    "map": {"tileUrl": "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "attribution": "© OpenStreetMap katkıcıları",
      "center": {"lat": 40.9885, "lng": 29.027}, "zoom": 15}
  }
}`

func TestEmbeddedWelcomeLoads(t *testing.T) {
	// Gomulu dosya her derlemede gecerli olmali: bozulursa gateway acilmaz.
	welcome, err := LoadWelcome(testResolver(t))
	if err != nil {
		t.Fatalf("gomulu icerik yuklenemedi: %v", err)
	}
	for _, source := range welcome.Hero.Banner.Sources {
		if !strings.HasPrefix(source.URL, testAssetBase+"/img/banner/") {
			t.Errorf("banner adresi kokun altinda olmali: %q", source.URL)
		}
	}
	if got := welcome.LoginCard.Countries[0].FlagURL; got != testAssetBase+"/img/flag/tr.svg" {
		t.Errorf("bayrak adresi: %q", got)
	}
	// Tanitim bolumleri (T11.7): gorseller kokun altinda, magaza baglantisi
	// disari giden adres oldugu gibi.
	if got := welcome.AppDownload.Image.URL; got != testAssetBase+"/img/landing/telefonlar.png" {
		t.Errorf("telefon gorseli: %q", got)
	}
	for _, store := range welcome.AppDownload.Stores {
		if !strings.HasPrefix(store.Badge.URL, testAssetBase+"/img/store/") || !strings.HasPrefix(store.URL, "https://") {
			t.Errorf("magaza rozeti kokun altinda, baglanti https olmali: %+v", store)
		}
	}
	if len(welcome.Features) != 3 {
		t.Errorf("uc tanitim kutusu bekleniyordu: %d", len(welcome.Features))
	}
	// Adres penceresi (T11.8): uc tur, karo adresi disari giden adres oldugu gibi.
	if setup := welcome.AddressSetup; len(setup.Kinds) != 3 || setup.Map.TileURL != "https://tile.openstreetmap.org/{z}/{x}/{y}.png" {
		t.Errorf("adres penceresi: %d tur, karo %q", len(setup.Kinds), setup.Map.TileURL)
	}
}

func TestParseKeepsStoreLinkAsIs(t *testing.T) {
	// Magaza baglantisi ASSET_BASE_URL ile cozulmez: disari giden adrestir.
	welcome, err := parseWelcome([]byte(validJSON), testResolver(t))
	if err != nil {
		t.Fatalf("gecerli icerik reddedildi: %v", err)
	}
	if got := welcome.AppDownload.Stores[0].URL; got != "https://apps.apple.com/app/id995280265" {
		t.Errorf("magaza baglantisi degismemeli: %q", got)
	}
	if got := welcome.Features[0].Image.URL; got != testAssetBase+"/img/tanitim/teslimat.png" {
		t.Errorf("kutu gorseli: %q", got)
	}
}

func TestParseResolvesImagesWithoutTouchingTexts(t *testing.T) {
	welcome, err := parseWelcome([]byte(validJSON), testResolver(t))
	if err != nil {
		t.Fatalf("gecerli icerik reddedildi: %v", err)
	}
	if got := welcome.Hero.Banner.Sources[0].URL; got != testAssetBase+"/img/banner/a-960.jpg" {
		t.Errorf("banner adresi: %q", got)
	}
	if welcome.Hero.Title != "Kapına gelen market" || welcome.LoginCard.Login.PendingLabel != "Giriş yapılıyor…" {
		t.Errorf("metinler oldugu gibi kalmali: %+v", welcome)
	}
}

func TestParseRejectsUnknownField(t *testing.T) {
	// Yazim hatali alan adi ("tilte") sessizce bos baslik olmasin.
	raw := strings.Replace(validJSON, `"categories": {"title"`, `"categories": {"tilte"`, 1)
	if _, err := parseWelcome([]byte(raw), testResolver(t)); err == nil || !strings.Contains(err.Error(), "tilte") {
		t.Fatalf("bilinmeyen alan reddedilmeliydi: %v", err)
	}
}

func TestParseRejectsTrailingContent(t *testing.T) {
	if _, err := parseWelcome([]byte(validJSON+`{}`), testResolver(t)); err == nil {
		t.Fatal("dosyanin sonundaki fazlalik reddedilmeliydi")
	}
}

func TestParseRejectsMissingText(t *testing.T) {
	// Alan hic yazilmazsa bos metin olur; dogrulama alanin yolunu soyler.
	raw := strings.Replace(validJSON, `"pendingLabel": "Giriş yapılıyor…",`, ``, 1)
	_, err := parseWelcome([]byte(raw), testResolver(t))
	if err == nil || !strings.Contains(err.Error(), "loginCard.login.pendingLabel bos") {
		t.Fatalf("eksik metin alanin yoluyla bildirilmeliydi: %v", err)
	}
}

func TestParseRejectsUnresolvableImage(t *testing.T) {
	// http(s) disi sema istemciye gitmez (assets.Resolver ""); icerik acilmaz.
	raw := strings.Replace(validJSON, `"/img/flag/tr.svg"`, `"javascript:alert(1)"`, 1)
	_, err := parseWelcome([]byte(raw), testResolver(t))
	if err == nil || !strings.Contains(err.Error(), "loginCard.countries[0].flagUrl") {
		t.Fatalf("cozulemeyen gorsel reddedilmeliydi: %v", err)
	}
}

func TestStaticReturnsLoadedWelcome(t *testing.T) {
	welcome, err := parseWelcome([]byte(validJSON), testResolver(t))
	if err != nil {
		t.Fatalf("gecerli icerik reddedildi: %v", err)
	}
	got, err := NewStatic(welcome).Welcome(t.Context())
	if err != nil {
		t.Fatalf("kaynak hata dondu: %v", err)
	}
	if got.Header.Brand != "getir" || len(got.LoginCard.Countries) != 1 {
		t.Errorf("yuklenen icerik donmeli: %+v", got)
	}
}
