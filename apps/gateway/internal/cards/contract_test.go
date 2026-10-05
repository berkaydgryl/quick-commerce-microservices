package cards

import (
	"testing"

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
