package content

import (
	"slices"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Icerik sinirlarinin iki kopyasi vardir: @getir/contracts (web cevabi Zod ile
// dogrular) ve bu paket (dosyayi acilista dogrular). Biri degisip digeri
// unutulursa gateway'in kabul ettigi icerigi web reddederdi.

func TestLimitsMatchContractConstants(t *testing.T) {
	source := testkit.ReadContract(t, testkit.ContractConstantsPath)

	for name, goValue := range map[string]int{
		"CONTENT_TEXT_MAX_LENGTH":     MaxTextLength,
		"CONTENT_BANNER_SOURCES_MAX":  MaxBannerSources,
		"CONTENT_PHONE_COUNTRIES_MAX": MaxPhoneCountries,
		"CONTENT_STORE_LINKS_MAX":     MaxStoreLinks,
		"CONTENT_FEATURES_MAX":        MaxFeatures,
		"CONTENT_MAP_ZOOM_MIN":        MinMapZoom,
		"CONTENT_MAP_ZOOM_MAX":        MaxMapZoom,
	} {
		if contractValue := testkit.NumberConstant(t, source, name); contractValue != goValue {
			t.Errorf("%s: sozlesme %d, gateway %d", name, contractValue, goValue)
		}
	}
	for name, goPattern := range map[string]string{
		"DIAL_CODE_PATTERN":    dialCodePattern,
		"COUNTRY_CODE_PATTERN": countryCodePattern,
	} {
		if pattern := testkit.PatternConstant(t, source, name); pattern != goPattern {
			t.Errorf("%s: sozlesme %q, gateway %q", name, pattern, goPattern)
		}
	}
}

// Dukkan turlerinin listesi (T11.12) @getir/contracts storeTypeSchema ile ayni
// sirada olmali: icerik o listeyle dogrulanir, web ayni listeyi bekler.
func TestStoreTypesMatchContract(t *testing.T) {
	source := testkit.ReadContract(t, "../../../../packages/contracts/src/catalog.ts")
	if contract := testkit.StringEnum(t, source, "storeTypeSchema"); !slices.Equal(storeTypes, contract) {
		t.Errorf("dukkan turleri farkli:\n gateway  %v\n sozlesme %v", storeTypes, contract)
	}
}
