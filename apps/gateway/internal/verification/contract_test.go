package verification

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Kod kurallarinin iki kopyasi vardir: @getir/contracts (web formu, geri sayim)
// ve bu paket. Anahtar bicimi @getir/redis-kit keys.ts'te tanimlidir.

const (
	contractVerificationPath = "../../../../packages/contracts/src/verification.ts"
	redisKitKeysPath         = "../../../../packages/redis-kit/src/keys.ts"
)

func TestRulesMatchContractConstants(t *testing.T) {
	source := testkit.ReadContract(t, testkit.ContractConstantsPath)

	if pattern := testkit.PatternConstant(t, source, "OTP_PATTERN"); pattern != codePattern {
		t.Errorf("OTP_PATTERN: sozlesme %q, gateway %q", pattern, codePattern)
	}
	for name, goValue := range map[string]int{
		"VERIFICATION_CODE_TTL_SECONDS":    int(CodeTTL.Seconds()),
		"VERIFICATION_CODE_MAX_ATTEMPTS":   MaxAttempts,
		"VERIFICATION_CODE_RESEND_SECONDS": int(ResendAfter.Seconds()),
	} {
		if contractValue := testkit.NumberConstant(t, source, name); contractValue != goValue {
			t.Errorf("%s: sozlesme %d, gateway %d", name, contractValue, goValue)
		}
	}
}

func TestCodeReasonMatchesContract(t *testing.T) {
	messages := testkit.ReadContract(t, contractVerificationPath)
	if !strings.Contains(messages, "'"+CodeReason+"'") {
		t.Errorf("kod cumlesi sozlesmede yok ya da farkli: %q", CodeReason)
	}
}

func TestKeysMatchRedisKit(t *testing.T) {
	raw, err := os.ReadFile(redisKitKeysPath)
	if err != nil {
		t.Fatalf("redis-kit anahtar kaynagi okunamadi: %v", err)
	}
	source := string(raw)
	hashTag := regexp.MustCompile("export function hashTag\\(value: string\\): string \\{\\s*return `([^`]+)`;").FindStringSubmatch(source)
	if hashTag == nil {
		t.Fatal("keys.ts'te hashTag bulunamadi")
	}
	const userID = "usr_0123456789abcdef0123456789abcdef"
	tagged := strings.ReplaceAll(hashTag[1], "${value}", userID)

	for function, channel := range map[string]Channel{"emailVerificationKey": ChannelEmail, "phoneVerificationKey": ChannelPhone} {
		match := regexp.MustCompile("(?s)export function " + function + "\\(userId: string\\): string \\{.*?return `([^`]+)`;").FindStringSubmatch(source)
		if match == nil {
			t.Fatalf("keys.ts'te %s(userId) bulunamadi; imza degistiyse bu testi de guncelle", function)
		}
		expected := strings.ReplaceAll(match[1], "${hashTag(userId)}", tagged)
		if got := Key(channel, userID); got != expected {
			t.Errorf("%s: redis-kit %q, gateway %q", function, expected, got)
		}
	}
}
