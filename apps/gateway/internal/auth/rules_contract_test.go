package auth

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// Kurallarin iki kopyasi vardir: @getir/contracts (web formu ve Node) ve bu
// paket (gateway). Go TypeScript okuyamaz; bu test sozlesme kaynagini metin
// olarak okuyup iki tarafi karsilastirir. Biri degisip digeri unutulursa
// kirmizi olur (error-codes.ts icin codes:go:check'in yaptigi is).

const (
	contractConstantsPath = "../../../../packages/contracts/src/constants.ts"
	contractAuthPath      = "../../../../packages/contracts/src/auth.ts"
)

func readContract(t *testing.T, path string) string {
	t.Helper()
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("sozlesme kaynagi okunamadi (%s): %v", path, err)
	}
	return string(source)
}

// numberConstant, `export const AD = 8;` satirindaki sayi.
func numberConstant(t *testing.T, source, name string) int {
	t.Helper()
	match := regexp.MustCompile(`export const ` + name + ` = (\d+);`).FindStringSubmatch(source)
	if match == nil {
		t.Fatalf("%s sozlesmede bulunamadi", name)
	}
	value, err := strconv.Atoi(match[1])
	if err != nil {
		t.Fatalf("%s sayi degil: %v", name, err)
	}
	return value
}

func TestRulesMatchContractConstants(t *testing.T) {
	source := readContract(t, contractConstantsPath)

	pattern := regexp.MustCompile(`export const PHONE_PATTERN = /(.+)/;`).FindStringSubmatch(source)
	if pattern == nil || pattern[1] != phonePattern {
		t.Errorf("PHONE_PATTERN: sozlesme %v, gateway %q", pattern, phonePattern)
	}
	for name, goValue := range map[string]int{
		"PASSWORD_MIN_LENGTH":  passwordMinLength,
		"PASSWORD_MAX_LENGTH":  passwordMaxBytes,
		"FULL_NAME_MIN_LENGTH": fullNameMinLength,
		"FULL_NAME_MAX_LENGTH": fullNameMaxLength,
		"SAVED_ADDRESSES_MAX":  MaxSavedAddresses,
	} {
		if contractValue := numberConstant(t, source, name); contractValue != goValue {
			t.Errorf("%s: sozlesme %d, gateway %d", name, contractValue, goValue)
		}
	}
}

func TestReasonsMatchContractMessages(t *testing.T) {
	// Web formu ile gateway ayni hatayi ayni cumleyle gostersin: auth.ts'teki
	// sablonlar sabitlerle doldurulur ve her gateway sebebi orada aranir.
	constants := readContract(t, contractConstantsPath)
	messages := readContract(t, contractAuthPath)
	for _, name := range []string{"PASSWORD_MIN_LENGTH", "PASSWORD_MAX_LENGTH", "FULL_NAME_MIN_LENGTH", "FULL_NAME_MAX_LENGTH"} {
		messages = strings.ReplaceAll(messages, "${"+name+"}", strconv.Itoa(numberConstant(t, constants, name)))
	}

	for _, reason := range []string{phoneReason, passwordMinReason, passwordMaxReason, fullNameMinReason, fullNameMaxReason} {
		if !strings.Contains(messages, reason) {
			t.Errorf("sebep sozlesmede yok ya da farkli: %q", reason)
		}
	}
}
