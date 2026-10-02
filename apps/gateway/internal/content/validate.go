package content

import (
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"strings"
	"unicode/utf16"
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

// validateWelcome, icerigin sozlesmeye uydugunu dogrular. Gorsel yollari
// henuz goreli oldugu icin URL kurali burada degil, cozumlemede (load.go)
// uygulanir.
func validateWelcome(welcome Welcome) error {
	return errors.Join(
		checkTexts(reflect.ValueOf(welcome), ""),
		checkBanner(welcome.Hero.Banner),
		checkCountries(welcome.LoginCard.Countries),
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

func joinPath(path, name string) string {
	if path == "" {
		return name
	}
	return path + "." + name
}
