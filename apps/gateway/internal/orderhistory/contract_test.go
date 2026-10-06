package orderhistory

import (
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Sayfa kurallarinin iki kopyasi vardir: @getir/contracts (web) ve bu paket.
// Ayrilirlarsa web'in bekledigi sayfa boyu gateway'inkini asardi.

func TestPageRulesMatchContract(t *testing.T) {
	constants := testkit.ReadContract(t, testkit.ContractConstantsPath)
	for name, goValue := range map[string]int{
		"ORDER_HISTORY_PAGE_SIZE_DEFAULT": DefaultPageSize,
		"ORDER_HISTORY_PAGE_SIZE_MAX":     MaxPageSize,
	} {
		if contractValue := testkit.NumberConstant(t, constants, name); contractValue != goValue {
			t.Errorf("%s: sozlesme %d, gateway %d", name, contractValue, goValue)
		}
	}
}
