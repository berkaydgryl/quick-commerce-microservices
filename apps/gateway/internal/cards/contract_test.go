package cards

import (
	"strings"
	"testing"

	cardvaultv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/cardvault/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Kart kurallarinin iki kopyasi vardir: @getir/contracts (web ve payment) ve
// bu paket. Biri degisip digeri unutulursa web'in gonderdigi istegi gateway
// reddederdi ya da kasanin dondurdugu listeyi tasiyamazdi.

func TestRulesMatchContract(t *testing.T) {
	constants := testkit.ReadContract(t, testkit.ContractConstantsPath)
	for name, goValue := range map[string]int{
		"SAVED_CARDS_MAX":             MaxCards,
		"CARD_NUMBER_MIN_DIGITS":      NumberMinDigits,
		"CARD_NUMBER_MAX_DIGITS":      NumberMaxDigits,
		"CARD_HOLDER_NAME_MIN_LENGTH": HolderNameMinLength,
		"CARD_HOLDER_NAME_MAX_LENGTH": HolderNameMaxLength,
		"CARD_NICKNAME_MAX_LENGTH":    NicknameMaxLength,
	} {
		if contractValue := testkit.NumberConstant(t, constants, name); contractValue != goValue {
			t.Errorf("%s: sozlesme %d, gateway %d", name, contractValue, goValue)
		}
	}
}

// contractCardRulesPath, kart kurallarinin (@getir/contracts card-rules.ts) yolu.
const contractCardRulesPath = "../../../../packages/contracts/src/card-rules.ts"

func TestBrandsMatchContract(t *testing.T) {
	// REST'e giden marka adlari sozlesmedeki cardBrandSchema ile ayni ve ayni sirada.
	contract := testkit.StringEnum(t, testkit.ReadContract(t, contractCardRulesPath), "cardBrandSchema")
	gateway := make([]string, 0, len(brandNames))
	for _, brand := range []cardvaultv1.CardBrand{
		cardvaultv1.CardBrand_CARD_BRAND_VISA,
		cardvaultv1.CardBrand_CARD_BRAND_MASTERCARD,
		cardvaultv1.CardBrand_CARD_BRAND_AMEX,
		cardvaultv1.CardBrand_CARD_BRAND_TROY,
	} {
		gateway = append(gateway, brandNames[brand])
	}
	if len(brandNames) != len(contract) || strings.Join(gateway, ",") != strings.Join(contract, ",") {
		t.Errorf("markalar ayrisiyor: sozlesme %v, gateway %v", contract, gateway)
	}
}
