package geo

import (
	"strconv"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Arama kurallarinin iki kopyasi vardir: @getir/contracts (web formu) ve bu
// paket. Biri degisip digeri unutulursa web'in gonderdigi aramayi gateway
// reddederdi (ya da tersi).

const contractGeoPath = "../../../../packages/contracts/src/geo.ts"

func TestRulesMatchContract(t *testing.T) {
	constants := testkit.ReadContract(t, testkit.ContractConstantsPath)
	messages := testkit.ReadContract(t, contractGeoPath)
	for name, goValue := range map[string]int{
		"GEO_SEARCH_QUERY_MIN_LENGTH": SearchQueryMinLength,
		"GEO_SEARCH_QUERY_MAX_LENGTH": SearchQueryMaxLength,
		"GEO_SEARCH_RESULTS_MAX":      SearchResultsMax,
		"ADDRESS_LINE_MAX_LENGTH":     lineMaxLength,
	} {
		contractValue := testkit.NumberConstant(t, constants, name)
		if contractValue != goValue {
			t.Errorf("%s: sozlesme %d, gateway %d", name, contractValue, goValue)
		}
		messages = strings.ReplaceAll(messages, "${"+name+"}", strconv.Itoa(contractValue))
	}
	for _, reason := range []string{queryMinReason, queryMaxReason} {
		if !strings.Contains(messages, reason) {
			t.Errorf("sebep sozlesmede yok ya da farkli: %q", reason)
		}
	}
}
