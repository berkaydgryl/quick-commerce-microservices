package content

import (
	"encoding/json"
	"strings"
	"testing"
)

// validWelcome, validJSON'un (load_test.go) cozulmus hali.
func validWelcome(t *testing.T) Welcome {
	t.Helper()
	var welcome Welcome
	if err := json.Unmarshal([]byte(validJSON), &welcome); err != nil {
		t.Fatalf("ornek icerik cozulemedi: %v", err)
	}
	return welcome
}

func expectProblem(t *testing.T, welcome Welcome, want string) {
	t.Helper()
	err := validateWelcome(welcome)
	if err == nil || !strings.Contains(err.Error(), want) {
		t.Fatalf("%q iceren hata bekleniyordu: %v", want, err)
	}
}

func TestValidateAcceptsValidWelcome(t *testing.T) {
	if err := validateWelcome(validWelcome(t)); err != nil {
		t.Fatalf("gecerli icerik reddedildi: %v", err)
	}
}

func TestValidateRejectsBlankText(t *testing.T) {
	welcome := validWelcome(t)
	welcome.Header.RegisterLabel = "   "
	expectProblem(t, welcome, "header.registerLabel bos")
}

func TestValidateCountsTextLikeJavaScript(t *testing.T) {
	// Sinir UTF-16 birimiyle sayilir (Zod .max()): 100 emoji 200 birimdir ve
	// sinirdadir, 101 emoji siniri asar. Rune sayseydi 199 emoji gecerdi ve
	// web cevabi reddederdi.
	welcome := validWelcome(t)
	welcome.Categories.Title = strings.Repeat("🛒", MaxTextLength/2)
	if err := validateWelcome(welcome); err != nil {
		t.Fatalf("sinirdaki metin reddedildi: %v", err)
	}
	welcome.Categories.Title = strings.Repeat("🛒", MaxTextLength/2+1)
	expectProblem(t, welcome, "categories.title 202 karakter")
}

func TestValidateChecksTextsInsideLists(t *testing.T) {
	welcome := validWelcome(t)
	welcome.LoginCard.Countries[0].Name = ""
	expectProblem(t, welcome, "loginCard.countries[0].name bos")
}

func TestValidateBannerSources(t *testing.T) {
	welcome := validWelcome(t)
	welcome.Hero.Banner.Sources = nil
	expectProblem(t, welcome, "hero.banner.sources 0 boy")

	welcome = validWelcome(t)
	source := welcome.Hero.Banner.Sources[0]
	welcome.Hero.Banner.Sources = []BannerSource{source, source, source, source, source}
	expectProblem(t, welcome, "hero.banner.sources 5 boy")

	welcome = validWelcome(t)
	welcome.Hero.Banner.Sources = []BannerSource{{URL: "/a.jpg", Width: 1920}, {URL: "/b.jpg", Width: 960}}
	expectProblem(t, welcome, "hero.banner.sources[1].width 960")

	welcome = validWelcome(t)
	welcome.Hero.Banner.Height = 0
	expectProblem(t, welcome, "hero.banner dogal boyutu")
}

func TestValidateCountries(t *testing.T) {
	welcome := validWelcome(t)
	welcome.LoginCard.Countries = nil
	expectProblem(t, welcome, "loginCard.countries 0 satir")

	welcome = validWelcome(t)
	welcome.LoginCard.Countries[0].DialCode = "+090"
	expectProblem(t, welcome, `dialCode "+090"`)

	welcome = validWelcome(t)
	welcome.LoginCard.Countries[0].Code = "tr"
	expectProblem(t, welcome, `code "tr"`)

	welcome = validWelcome(t)
	welcome.LoginCard.Countries = append(welcome.LoginCard.Countries, welcome.LoginCard.Countries[0])
	expectProblem(t, welcome, `loginCard.countries[1].code "TR" iki kez`)
}

func TestValidateReportsEveryProblem(t *testing.T) {
	// Butun sorunlar tek seferde: icerigi duzelten kisi her acilista bir
	// sonrakini ogrenmesin.
	welcome := validWelcome(t)
	welcome.Header.Brand = ""
	welcome.Hero.Banner.Width = 0
	welcome.LoginCard.Countries[0].DialCode = "90"
	err := validateWelcome(welcome)
	if err == nil {
		t.Fatal("hata bekleniyordu")
	}
	for _, want := range []string{"header.brand bos", "hero.banner dogal boyutu", `dialCode "90"`} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("%q eksik: %v", want, err)
		}
	}
}

func TestValidateStoreLinks(t *testing.T) {
	for _, link := range []string{"http://apps.apple.com/app/1", "javascript:alert(1)", "/magaza", "https://"} {
		welcome := validWelcome(t)
		welcome.AppDownload.Stores[0].URL = link
		expectProblem(t, welcome, "appDownload.stores[0].url")
	}

	welcome := validWelcome(t)
	welcome.AppDownload.Stores = nil
	expectProblem(t, welcome, "appDownload.stores 0 rozet")

	welcome = validWelcome(t)
	store := welcome.AppDownload.Stores[0]
	welcome.AppDownload.Stores = []StoreLink{store, store, store, store, store}
	expectProblem(t, welcome, "appDownload.stores 5 rozet")

	welcome = validWelcome(t)
	welcome.AppDownload.Stores[0].Badge.Width = 0
	expectProblem(t, welcome, "appDownload.stores[0].badge dogal boyutu")
}

func TestValidateFeatures(t *testing.T) {
	welcome := validWelcome(t)
	welcome.Features = nil
	expectProblem(t, welcome, "features 0 kutu")

	welcome = validWelcome(t)
	feature := welcome.Features[0]
	welcome.Features = []Feature{feature, feature, feature, feature, feature, feature, feature}
	expectProblem(t, welcome, "features 7 kutu")

	welcome = validWelcome(t)
	welcome.Features[0].Text = " "
	expectProblem(t, welcome, "features[0].text bos")

	welcome = validWelcome(t)
	welcome.AppDownload.Image.Height = 0
	expectProblem(t, welcome, "appDownload.image dogal boyutu")
}
