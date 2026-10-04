package emailverify

import (
	"strconv"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// E-posta kurallarinin iki kopyasi vardir: @getir/contracts (web formu) ve bu
// paket. Biri degisip digeri unutulursa form gecerli dedigi adresi gateway
// reddeder. Kod kurallari ve anahtar bicimi verification'in testlerinde.

const contractEmailPath = "../../../../packages/contracts/src/email.ts"

func TestRulesMatchContractConstants(t *testing.T) {
	source := testkit.ReadContract(t, testkit.ContractConstantsPath)

	if pattern := testkit.PatternConstant(t, source, "EMAIL_PATTERN"); pattern != emailPattern {
		t.Errorf("EMAIL_PATTERN: sozlesme %q, gateway %q", pattern, emailPattern)
	}
	if contractValue := testkit.NumberConstant(t, source, "EMAIL_MAX_LENGTH"); contractValue != emailMaxLength {
		t.Errorf("EMAIL_MAX_LENGTH: sozlesme %d, gateway %d", contractValue, emailMaxLength)
	}
}

func TestReasonsMatchContractMessages(t *testing.T) {
	// Form ve gateway ayni bicim hatasini ayni cumleyle gostersin.
	constants := testkit.ReadContract(t, testkit.ContractConstantsPath)
	messages := strings.ReplaceAll(testkit.ReadContract(t, contractEmailPath),
		"${EMAIL_MAX_LENGTH}", strconv.Itoa(testkit.NumberConstant(t, constants, "EMAIL_MAX_LENGTH")))

	for _, reason := range []string{emailReason, emailMaxReason} {
		if !strings.Contains(messages, "'"+reason+"'") && !strings.Contains(messages, "`"+reason+"`") {
			t.Errorf("sebep sozlesmede yok ya da farkli: %q", reason)
		}
	}
}
