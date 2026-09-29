package httpapi

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// Anahtar kurali uc yerde uygulanir: REST basligi (@getir/contracts), Redis
// anahtari (@getir/redis-kit) ve gateway. Tek kaynak @getir/core'daki
// sabitlerdir; bu test onlari metin olarak okuyup gateway'inkilerle
// karsilastirir (auth/rules_contract_test.go ile ayni yontem).

const coreConstantsPath = "../../../../packages/core/src/constants.ts"

func TestIdempotencyKeyRuleMatchesCore(t *testing.T) {
	raw, err := os.ReadFile(coreConstantsPath)
	if err != nil {
		t.Fatalf("core sabitleri okunamadi (%s): %v", coreConstantsPath, err)
	}
	source := string(raw)

	for name, goValue := range map[string]int{
		"IDEMPOTENCY_KEY_MIN_LENGTH": idempotencyKeyMinLength,
		"IDEMPOTENCY_KEY_MAX_LENGTH": idempotencyKeyMaxLength,
	} {
		match := regexp.MustCompile(`export const ` + name + ` = (\d+);`).FindStringSubmatch(source)
		if match == nil {
			t.Errorf("%s core'da bulunamadi", name)
			continue
		}
		coreValue, err := strconv.Atoi(match[1])
		if err != nil {
			t.Fatalf("%s sayi degil: %v", name, err)
		}
		if coreValue != goValue {
			t.Errorf("%s: core %d, gateway %d", name, coreValue, goValue)
		}
	}

	charset := regexp.MustCompile(`export const IDEMPOTENCY_KEY_CHARSET = '([^']+)';`).FindStringSubmatch(source)
	if charset == nil || charset[1] != idempotencyKeyCharset {
		t.Errorf("IDEMPOTENCY_KEY_CHARSET: core %v, gateway %q", charset, idempotencyKeyCharset)
	}
}

func TestIdempotencyKeyBoundaries(t *testing.T) {
	for key, valid := range map[string]bool{
		"12345678":                             true,
		"1234567":                              false,
		strings.Repeat("a", 128):               true,
		strings.Repeat("a", 129):               false,
		"4f1c3a2b-9d8e-4b7a-8c6d-5e4f3a2b1c0d": true,
		"kayit_anahtari-01":                    true,
		"iki:nokta-anahtar":                    false,
		"{usr_1}-anahtar":                      false,
		"bosluklu anahtar":                     false,
		"türkçe-anahtar":                       false,
	} {
		if got := validIdempotencyKey(key); got != valid {
			t.Errorf("%q: gecerli=%v bekleniyordu", key, valid)
		}
	}
}
