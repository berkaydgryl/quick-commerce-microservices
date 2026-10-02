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
      "registerPrompt": "Hesabın yok mu?", "registerLinkLabel": "Kayıt ol"},
    "register": {"fullNameLabel": "Adın soyadın", "passwordLabel": "Şifre belirle", "submitLabel": "Kayıt ol",
      "pendingLabel": "Kaydın yapılıyor…", "loginPrompt": "Zaten hesabın var mı?", "loginLinkLabel": "Giriş yap"}
  },
  "categories": {"title": "Kategoriler"}
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
