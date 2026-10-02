package auth

import (
	"strconv"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Kurallarin iki kopyasi vardir: @getir/contracts (web formu ve Node) ve bu
// paket (gateway). Okuma yardimcilari testkit/contract.go'dadir.

const contractAuthPath = "../../../../packages/contracts/src/auth.ts"

func TestRulesMatchContractConstants(t *testing.T) {
	source := testkit.ReadContract(t, testkit.ContractConstantsPath)

	if pattern := testkit.PatternConstant(t, source, "PHONE_PATTERN"); pattern != phonePattern {
		t.Errorf("PHONE_PATTERN: sozlesme %q, gateway %q", pattern, phonePattern)
	}
	for name, goValue := range map[string]int{
		"PASSWORD_MIN_LENGTH":  passwordMinLength,
		"PASSWORD_MAX_LENGTH":  passwordMaxBytes,
		"FULL_NAME_MIN_LENGTH": fullNameMinLength,
		"FULL_NAME_MAX_LENGTH": fullNameMaxLength,
		"SAVED_ADDRESSES_MAX":  MaxSavedAddresses,
	} {
		if contractValue := testkit.NumberConstant(t, source, name); contractValue != goValue {
			t.Errorf("%s: sozlesme %d, gateway %d", name, contractValue, goValue)
		}
	}
}

func TestReasonsMatchContractMessages(t *testing.T) {
	// Web formu ile gateway ayni hatayi ayni cumleyle gostersin: auth.ts'teki
	// sablonlar sabitlerle doldurulur ve her gateway sebebi orada aranir.
	constants := testkit.ReadContract(t, testkit.ContractConstantsPath)
	messages := testkit.ReadContract(t, contractAuthPath)
	for _, name := range []string{"PASSWORD_MIN_LENGTH", "PASSWORD_MAX_LENGTH", "FULL_NAME_MIN_LENGTH", "FULL_NAME_MAX_LENGTH"} {
		messages = strings.ReplaceAll(messages, "${"+name+"}", strconv.Itoa(testkit.NumberConstant(t, constants, name)))
	}

	for _, reason := range []string{phoneReason, passwordMinReason, passwordMaxReason, fullNameMinReason, fullNameMaxReason} {
		if !strings.Contains(messages, reason) {
			t.Errorf("sebep sozlesmede yok ya da farkli: %q", reason)
		}
	}
}
