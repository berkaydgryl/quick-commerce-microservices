package content

import (
	"errors"
	"fmt"
	"net/url"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"unicode/utf16"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// Bicim kurallari (@getir/contracts constants.ts DIAL_CODE_PATTERN ve
// COUNTRY_CODE_PATTERN; esitligi contract_test.go denetler).
const (
	dialCodePattern    = `^\+[1-9][0-9]{0,2}$`
	countryCodePattern = `^[A-Z]{2}$`
)

var (
	dialCodeRule    = regexp.MustCompile(dialCodePattern)
	countryCodeRule = regexp.MustCompile(countryCodePattern)
)

// storeTypes, sozlesmedeki dukkan turleri, proto sirasiyla (@getir/contracts
// storeTypeSchema; esitligi contract_test.go denetler).
var storeTypes = []string{"MARKET", "MANAV", "KASAP", "SARKUTERI", "KURUYEMIS", "FIRIN", "PETSHOP", "CICEKCI"}

// validateWelcome, icerigin sozlesmeye uydugunu dogrular. Gorsel yollari
// henuz goreli oldugu icin URL kurali burada degil, cozumlemede (load.go)
// uygulanir.
func validateWelcome(welcome Welcome) error {
	return errors.Join(
		checkTexts(reflect.ValueOf(welcome), ""),
		checkBanner(welcome.Hero.Banner),
		checkCountries(welcome.LoginCard.Countries),
		checkAppDownload(welcome.AppDownload),
		checkFeatures(welcome.Features),
		checkAddressSetup(welcome.AddressSetup),
		checkMarketList(welcome.MarketList),
	)
}

// checkTexts, yapidaki HER metin alanini dolasir: bos ya da sinirdan uzun
// metin hatadir. Yansima (reflect) bilincli: yeni bir metin alani eklenince
// kural kendiliginden uygulanir, bir listeye eklemeyi unutmak mumkun olmaz.
// Hata alanin JSON yolunu tasir ("loginCard.login.submitLabel").
func checkTexts(value reflect.Value, path string) error {
	switch value.Kind() {
	case reflect.Struct:
		problems := make([]error, 0, value.NumField())
		for index := range value.NumField() {
			name := strings.Split(value.Type().Field(index).Tag.Get("json"), ",")[0]
			problems = append(problems, checkTexts(value.Field(index), joinPath(path, name)))
		}
		return errors.Join(problems...)
	case reflect.Slice:
		problems := make([]error, 0, value.Len())
		for index := range value.Len() {
			problems = append(problems, checkTexts(value.Index(index), fmt.Sprintf("%s[%d]", path, index)))
		}
		return errors.Join(problems...)
	case reflect.String:
		return checkText(path, value.String())
	default:
		return nil
	}
}

// checkText, tek metnin kurali: bos olamaz, en fazla MaxTextLength UTF-16
// birimi (Zod'un .max() olcusu; Go'nun rune sayisi emoji'de farkli cikardi).
func checkText(path, text string) error {
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("%s bos", path)
	}
	if length := len(utf16.Encode([]rune(text))); length > MaxTextLength {
		return fmt.Errorf("%s %d karakter, en fazla %d", path, length, MaxTextLength)
	}
	return nil
}

// checkBanner: en az bir, en fazla MaxBannerSources boy; genislikler pozitif
// ve kucukten buyuge (ayni genislik srcset'te gecersizdir); dogal boyut pozitif.
func checkBanner(banner Banner) error {
	const path = "hero.banner"
	if count := len(banner.Sources); count == 0 || count > MaxBannerSources {
		return fmt.Errorf("%s.sources %d boy, 1-%d olmali", path, count, MaxBannerSources)
	}
	problems := make([]error, 0, len(banner.Sources)+1)
	previous := 0
	for index, source := range banner.Sources {
		if source.Width <= previous {
			problems = append(problems, fmt.Errorf("%s.sources[%d].width %d: pozitif ve bir oncekinden buyuk olmali", path, index, source.Width))
		}
		previous = source.Width
	}
	if banner.Width <= 0 || banner.Height <= 0 {
		problems = append(problems, fmt.Errorf("%s dogal boyutu %dx%d: ikisi de pozitif olmali", path, banner.Width, banner.Height))
	}
	return errors.Join(problems...)
}

// checkCountries: en az bir, en fazla MaxPhoneCountries satir; kodlar
// bicimli ve tekil (secicide anahtar olarak kullanilir).
func checkCountries(countries []PhoneCountry) error {
	const path = "loginCard.countries"
	if count := len(countries); count == 0 || count > MaxPhoneCountries {
		return fmt.Errorf("%s %d satir, 1-%d olmali", path, count, MaxPhoneCountries)
	}
	problems := make([]error, 0, len(countries))
	seen := make(map[string]struct{}, len(countries))
	for index, country := range countries {
		if !countryCodeRule.MatchString(country.Code) {
			problems = append(problems, fmt.Errorf("%s[%d].code %q: ISO 3166-1 alfa-2 olmali", path, index, country.Code))
		}
		if !dialCodeRule.MatchString(country.DialCode) {
			problems = append(problems, fmt.Errorf("%s[%d].dialCode %q: + ve 1-3 rakam olmali", path, index, country.DialCode))
		}
		if _, duplicate := seen[country.Code]; duplicate {
			problems = append(problems, fmt.Errorf("%s[%d].code %q iki kez yazilmis", path, index, country.Code))
		}
		seen[country.Code] = struct{}{}
	}
	return errors.Join(problems...)
}

// checkAppDownload: gorsel boyutlari pozitif; en az bir, en fazla
// MaxStoreLinks rozet; magaza baglantisi mutlak https adresi (disari gider,
// gateway cozmez: "javascript:" ya da goreli yol istemciye gitmesin).
func checkAppDownload(download AppDownload) error {
	const path = "appDownload"
	problems := []error{checkImage(path+".image", download.Image)}
	if count := len(download.Stores); count == 0 || count > MaxStoreLinks {
		problems = append(problems, fmt.Errorf("%s.stores %d rozet, 1-%d olmali", path, count, MaxStoreLinks))
	}
	for index, store := range download.Stores {
		field := fmt.Sprintf("%s.stores[%d]", path, index)
		problems = append(problems, checkImage(field+".badge", store.Badge))
		if parsed, err := url.Parse(store.URL); err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			problems = append(problems, fmt.Errorf("%s.url %q: mutlak https adresi olmali", field, store.URL))
		}
	}
	return errors.Join(problems...)
}

// checkFeatures: en az bir, en fazla MaxFeatures kutu; gorsel boyutlari pozitif.
func checkFeatures(features []Feature) error {
	if count := len(features); count == 0 || count > MaxFeatures {
		return fmt.Errorf("features %d kutu, 1-%d olmali", count, MaxFeatures)
	}
	problems := make([]error, 0, len(features))
	for index, feature := range features {
		problems = append(problems, checkImage(fmt.Sprintf("features[%d].image", index), feature.Image))
	}
	return errors.Join(problems...)
}

// checkAddressSetup: adres turleri sozlesmedeki turlerden, her biri en fazla
// bir kez (secicide anahtar); harita gecerli.
func checkAddressSetup(setup AddressSetup) error {
	const path = "addressSetup"
	allowed := []string{auth.AddressKindHome, auth.AddressKindWork, auth.AddressKindOther}
	problems := []error{checkMap(path+".map", setup.Map)}
	if count := len(setup.Kinds); count == 0 || count > len(allowed) {
		problems = append(problems, fmt.Errorf("%s.kinds %d satir, 1-%d olmali", path, count, len(allowed)))
	}
	seen := make(map[string]struct{}, len(setup.Kinds))
	for index, option := range setup.Kinds {
		if !slices.Contains(allowed, option.Kind) {
			problems = append(problems, fmt.Errorf("%s.kinds[%d].kind %q: %s olmali", path, index, option.Kind, strings.Join(allowed, ", ")))
		}
		if _, duplicate := seen[option.Kind]; duplicate {
			problems = append(problems, fmt.Errorf("%s.kinds[%d].kind %q iki kez yazilmis", path, index, option.Kind))
		}
		seen[option.Kind] = struct{}{}
	}
	return errors.Join(problems...)
}

// checkMarketList (T11.12): her dukkan turunun adi tam bir kez yazilir ve her
// tur tam bir gruba aittir. Eksik tur istemcide menude gorunmeyen market,
// bilinmeyen tur adsiz satir olurdu.
func checkMarketList(list MarketList) error {
	const path = "marketList"
	labelled := make([]string, 0, len(list.StoreTypes))
	for _, option := range list.StoreTypes {
		labelled = append(labelled, option.Type)
	}
	problems := []error{checkStoreTypeCoverage(path+".storeTypes", labelled)}
	if len(list.Groups) == 0 {
		problems = append(problems, fmt.Errorf("%s.groups bos", path))
	}
	grouped := make([]string, 0, len(storeTypes))
	for index, group := range list.Groups {
		if len(group.Types) == 0 {
			problems = append(problems, fmt.Errorf("%s.groups[%d].types bos", path, index))
		}
		grouped = append(grouped, group.Types...)
	}
	problems = append(problems, checkStoreTypeCoverage(path+".groups", grouped))
	return errors.Join(problems...)
}

// checkStoreTypeCoverage: liste sozlesmedeki turlerin her birini tam bir kez tasir.
func checkStoreTypeCoverage(path string, types []string) error {
	var problems []error
	seen := make(map[string]int, len(types))
	for _, storeType := range types {
		if !slices.Contains(storeTypes, storeType) {
			problems = append(problems, fmt.Errorf("%s: bilinmeyen tur %q", path, storeType))
		}
		seen[storeType]++
	}
	for _, storeType := range storeTypes {
		switch count := seen[storeType]; count {
		case 1:
		case 0:
			problems = append(problems, fmt.Errorf("%s: %s yok", path, storeType))
		default:
			problems = append(problems, fmt.Errorf("%s: %s %d kez yazilmis", path, storeType, count))
		}
	}
	return errors.Join(problems...)
}

// checkMap: karo adresi mutlak https ve {z}, {x}, {y} yer tutuculu (disari
// gider: "javascript:" ya da goreli yol istemciye gitmesin); merkez gecerli
// koordinat; yakinlastirma MinMapZoom-MaxMapZoom.
func checkMap(path string, m Map) error {
	var problems []error
	parsed, err := url.Parse(m.TileURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		problems = append(problems, fmt.Errorf("%s.tileUrl %q: mutlak https adresi olmali", path, m.TileURL))
	}
	for _, part := range []string{"{z}", "{x}", "{y}"} {
		if !strings.Contains(m.TileURL, part) {
			problems = append(problems, fmt.Errorf("%s.tileUrl %q: %s yer tutucusu yok", path, m.TileURL, part))
		}
	}
	if m.Center.Lat < -90 || m.Center.Lat > 90 || m.Center.Lng < -180 || m.Center.Lng > 180 {
		problems = append(problems, fmt.Errorf("%s.center %v,%v: gecerli koordinat olmali", path, m.Center.Lat, m.Center.Lng))
	}
	if m.Zoom < MinMapZoom || m.Zoom > MaxMapZoom {
		problems = append(problems, fmt.Errorf("%s.zoom %d: %d-%d olmali", path, m.Zoom, MinMapZoom, MaxMapZoom))
	}
	return errors.Join(problems...)
}

// checkImage: dogal boyut pozitif (istemci yeri onceden ayirir).
func checkImage(path string, image Image) error {
	if image.Width <= 0 || image.Height <= 0 {
		return fmt.Errorf("%s dogal boyutu %dx%d: ikisi de pozitif olmali", path, image.Width, image.Height)
	}
	return nil
}

func joinPath(path, name string) string {
	if path == "" {
		return name
	}
	return path + "." + name
}
