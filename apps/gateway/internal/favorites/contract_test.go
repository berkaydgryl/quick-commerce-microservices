package favorites

import (
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Favori kurallarinin iki kopyasi vardir: @getir/contracts (web) ve bu paket.
// Biri degisip digeri unutulursa web'in gonderdigi istegi gateway reddederdi
// ya da web gateway'in kabul ettigi listeyi tasiyamazdi.

func TestRulesMatchContract(t *testing.T) {
	constants := testkit.ReadContract(t, testkit.ContractConstantsPath)
	for name, goValue := range map[string]int{
		"FAVORITE_MARKETS_MAX":  MaxMarkets,
		"CATALOG_ID_MAX_LENGTH": marketIDMaxLength,
	} {
		if contractValue := testkit.NumberConstant(t, constants, name); contractValue != goValue {
			t.Errorf("%s: sozlesme %d, gateway %d", name, contractValue, goValue)
		}
	}
	if pattern := testkit.StringConstant(t, constants, "CATALOG_ID_BODY_PATTERN"); pattern != marketIDBodyPattern {
		t.Errorf("CATALOG_ID_BODY_PATTERN: sozlesme %q, gateway %q", pattern, marketIDBodyPattern)
	}
}
