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

const contractCartPath = "../../../../packages/contracts/src/cart.ts"

func TestAddressRulesMatchContract(t *testing.T) {
	// T11.8: adres ekleme formunun sinirlari ve cumleleri (createAddressRequestSchema).
	constants := testkit.ReadContract(t, testkit.ContractConstantsPath)
	limits := map[string]int{
		"ADDRESS_TITLE_MAX_LENGTH": AddressTitleMaxLength,
		"ADDRESS_UNIT_MAX_LENGTH":  AddressUnitMaxLength,
		"ADDRESS_LINE_MAX_LENGTH":  addressLineMaxLength,
		"ADDRESS_NOTE_MAX_LENGTH":  addressNoteMaxLength,
	}
	messages := testkit.ReadContract(t, contractCartPath)
	for name, goValue := range limits {
		contractValue := testkit.NumberConstant(t, constants, name)
		if contractValue != goValue {
			t.Errorf("%s: sozlesme %d, gateway %d", name, contractValue, goValue)
		}
		messages = strings.ReplaceAll(messages, "${"+name+"}", strconv.Itoa(contractValue))
	}

	for _, reason := range []string{addressTitleRequiredReason, addressTitleMaxReason, addressLineRequiredReason, addressLineMaxReason, addressNoteMaxReason} {
		if !strings.Contains(messages, reason) {
			t.Errorf("sebep sozlesmede yok ya da farkli: %q", reason)
		}
	}
	// Bina, kat ve daire ayni sablonu paylasir: "${label} en fazla N karakter olabilir".
	for _, label := range []string{"Bina", "Kat", "Daire"} {
		if !strings.Contains(messages, "addressUnitSchema('"+label+"')") {
			t.Errorf("sozlesmede %q alani yok", label)
		}
	}
	if !strings.Contains(messages, "${label} en fazla "+strconv.Itoa(AddressUnitMaxLength)+" karakter olabilir") {
		t.Error("bina/kat/daire sablonu gateway'in cumlesiyle ayni olmali")
	}
	// Dolu defter yalnizca sunucunun kuralidir; sayi SAVED_ADDRESSES_MAX ile ayni olmali.
	if !strings.Contains(addressBookFullReason, strconv.Itoa(MaxSavedAddresses)) {
		t.Errorf("dolu defter cumlesi sinirla ayni sayiyi soylemeli: %q", addressBookFullReason)
	}
}
