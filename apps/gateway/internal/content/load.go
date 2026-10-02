package content

import (
	"bytes"
	_ "embed" // welcome.json ikiliye gomulur: imajda ayri dosya ve yol ayari gerekmez.
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

//go:embed welcome.json
var welcomeJSON []byte

// ImageResolver, verideki goreli gorsel yolunu mutlak URL'ye cevirir
// (assets.Resolver). Gecersiz yol icin "" doner.
type ImageResolver interface {
	Resolve(path string) string
}

// LoadWelcome, gomulu karsilama icerigini cozer, dogrular ve gorsel
// yollarini mutlak adrese cevirir. Hata acilisi durdurur (bootstrap).
func LoadWelcome(images ImageResolver) (Welcome, error) {
	return parseWelcome(welcomeJSON, images)
}

// parseWelcome, LoadWelcome'un dosyadan bagimsiz govdesi (testler bozuk
// icerik verir).
func parseWelcome(raw []byte, images ImageResolver) (Welcome, error) {
	welcome, err := decodeStrict(raw)
	if err != nil {
		return Welcome{}, fmt.Errorf("karsilama icerigi cozulemedi: %w", err)
	}
	if err := validateWelcome(welcome); err != nil {
		return Welcome{}, fmt.Errorf("karsilama icerigi gecersiz: %w", err)
	}
	resolved, err := resolveImages(welcome, images)
	if err != nil {
		return Welcome{}, fmt.Errorf("karsilama icerigi gorselleri: %w", err)
	}
	return resolved, nil
}

// decodeStrict, bilinmeyen alani ve dosyanin sonundaki fazlaligi reddeder:
// yazim hatali bir alan adi ("tilte") sessizce bos metin olmasin.
func decodeStrict(raw []byte) (Welcome, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var welcome Welcome
	if err := decoder.Decode(&welcome); err != nil {
		return Welcome{}, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return Welcome{}, errors.New("tek JSON nesnesinden sonra fazla icerik var")
	}
	return welcome, nil
}

// resolveImages, banner boylarini ve bayraklari mutlak adrese cevirir.
// Cozulemeyen yol (http(s) disi sema) hatadir: istemcide bos gorsel olurdu.
// Girdinin dilimleri degistirilmez, cevap yeni dilimlerle kurulur.
func resolveImages(welcome Welcome, images ImageResolver) (Welcome, error) {
	sources := make([]BannerSource, 0, len(welcome.Hero.Banner.Sources))
	for index, source := range welcome.Hero.Banner.Sources {
		url, err := resolve(images, source.URL, fmt.Sprintf("hero.banner.sources[%d].url", index))
		if err != nil {
			return Welcome{}, err
		}
		sources = append(sources, BannerSource{URL: url, Width: source.Width})
	}
	countries := make([]PhoneCountry, 0, len(welcome.LoginCard.Countries))
	for index, country := range welcome.LoginCard.Countries {
		url, err := resolve(images, country.FlagURL, fmt.Sprintf("loginCard.countries[%d].flagUrl", index))
		if err != nil {
			return Welcome{}, err
		}
		country.FlagURL = url
		countries = append(countries, country)
	}
	welcome.Hero.Banner.Sources = sources
	welcome.LoginCard.Countries = countries
	return welcome, nil
}

func resolve(images ImageResolver, path, field string) (string, error) {
	url := images.Resolve(path)
	if url == "" {
		return "", fmt.Errorf("%s %q mutlak adrese cevrilemedi", field, path)
	}
	return url, nil
}
