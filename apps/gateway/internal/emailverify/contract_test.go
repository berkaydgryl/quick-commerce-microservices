package emailverify

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Kurallarin iki kopyasi vardir: @getir/contracts (web formu) ve bu paket.
// Biri degisip digeri unutulursa form gecerli dedigi adresi gateway reddeder
// ya da geri sayim sunucunun suresinden ayrisir.

const contractEmailPath = "../../../../packages/contracts/src/email.ts"

func TestRulesMatchContractConstants(t *testing.T) {
	source := testkit.ReadContract(t, testkit.ContractConstantsPath)

	if pattern := testkit.PatternConstant(t, source, "EMAIL_PATTERN"); pattern != emailPattern {
		t.Errorf("EMAIL_PATTERN: sozlesme %q, gateway %q", pattern, emailPattern)
	}
	if pattern := testkit.PatternConstant(t, source, "OTP_PATTERN"); pattern != codePattern {
		t.Errorf("OTP_PATTERN: sozlesme %q, gateway %q", pattern, codePattern)
	}
	for name, goValue := range map[string]int{
		"EMAIL_MAX_LENGTH":          emailMaxLength,
		"EMAIL_CODE_TTL_SECONDS":    int(CodeTTL.Seconds()),
		"EMAIL_CODE_MAX_ATTEMPTS":   MaxAttempts,
		"EMAIL_CODE_RESEND_SECONDS": int(ResendAfter.Seconds()),
	} {
		if contractValue := testkit.NumberConstant(t, source, name); contractValue != goValue {
			t.Errorf("%s: sozlesme %d, gateway %d", name, contractValue, goValue)
		}
	}
}

func TestReasonsMatchContractMessages(t *testing.T) {
	// Form ve gateway ayni bicim hatasini ayni cumleyle gostersin.
	constants := testkit.ReadContract(t, testkit.ContractConstantsPath)
	messages := strings.ReplaceAll(testkit.ReadContract(t, contractEmailPath),
		"${EMAIL_MAX_LENGTH}", strconv.Itoa(testkit.NumberConstant(t, constants, "EMAIL_MAX_LENGTH")))

	for _, reason := range []string{emailReason, emailMaxReason, codeReason} {
		if !strings.Contains(messages, "'"+reason+"'") && !strings.Contains(messages, "`"+reason+"`") {
			t.Errorf("sebep sozlesmede yok ya da farkli: %q", reason)
		}
	}
}

// Anahtar bicimi @getir/redis-kit keys.ts'te tanimlidir (tek kaynak).
const redisKitKeysPath = "../../../../packages/redis-kit/src/keys.ts"

func TestKeyMatchesRedisKit(t *testing.T) {
	raw, err := os.ReadFile(redisKitKeysPath)
	if err != nil {
		t.Fatalf("redis-kit anahtar kaynagi okunamadi: %v", err)
	}
	source := string(raw)

	// keys.ts: emailVerificationKey(userId) -> `verify:email:${hashTag(userId)}`,
	// hashTag(value) -> `{${value}}`.
	function := regexp.MustCompile("(?s)export function emailVerificationKey\\(userId: string\\): string \\{.*?return `([^`]+)`;").FindStringSubmatch(source)
	if function == nil {
		t.Fatal("keys.ts'te emailVerificationKey(userId) bulunamadi; imza degistiyse bu testi de guncelle")
	}
	hashTag := regexp.MustCompile("export function hashTag\\(value: string\\): string \\{\\s*return `([^`]+)`;").FindStringSubmatch(source)
	if hashTag == nil {
		t.Fatal("keys.ts'te hashTag bulunamadi")
	}
	const userID = "usr_0123456789abcdef0123456789abcdef"
	expected := strings.ReplaceAll(function[1], "${hashTag(userId)}", strings.ReplaceAll(hashTag[1], "${value}", userID))

	if got := Key(userID); got != expected {
		t.Errorf("anahtar bicimi ayrisiyor: redis-kit %q, gateway %q", expected, got)
	}
}
