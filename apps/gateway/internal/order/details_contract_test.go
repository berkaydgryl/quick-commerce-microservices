package order

import (
	"regexp"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Siparis ayrintisi ve kart secimi kurallarinin (T12.4) iki kopyasi vardir:
// @getir/contracts (web formu ve order-service) ve bu paket. Biri degisip
// digeri unutulursa kirmizi olur. Okuma yardimcilari testkit/contract.go'da.

const (
	contractCheckoutRulesPath = "../../../../packages/contracts/src/checkout-rules.ts"
	contractAuthPath          = "../../../../packages/contracts/src/auth.ts"
	contractOrderPath         = "../../../../packages/contracts/src/order.ts"
)

func TestDetailsLimitsMatchContract(t *testing.T) {
	rules := testkit.ReadContract(t, contractCheckoutRulesPath)
	for name, goValue := range map[string]int{
		"CHECKOUT_TEXT_MAX": CheckoutTextMax,
		"GIFT_NAME_MAX":     GiftNameMax,
	} {
		if contractValue := testkit.NumberConstant(t, rules, name); contractValue != goValue {
			t.Errorf("%s: sozlesme %d, gateway %d", name, contractValue, goValue)
		}
	}
	// Alici telefonu giris ve kayitla ayni kural (PHONE_PATTERN).
	constants := testkit.ReadContract(t, testkit.ContractConstantsPath)
	if pattern := testkit.PatternConstant(t, constants, "PHONE_PATTERN"); pattern != giftPhonePattern {
		t.Errorf("PHONE_PATTERN: sozlesme %q, gateway %q", pattern, giftPhonePattern)
	}
}

func TestDetailsReasonsMatchContractMessages(t *testing.T) {
	// Her sebep sozlesmedeki AYNI adli cumleyle BIREBIR esit (icerme degil):
	// sablonlar sinirlarla doldurulur.
	rules := testkit.ReadContract(t, contractCheckoutRulesPath)
	limits := map[string]int{
		"CHECKOUT_TEXT_MAX": testkit.NumberConstant(t, rules, "CHECKOUT_TEXT_MAX"),
		"GIFT_NAME_MAX":     testkit.NumberConstant(t, rules, "GIFT_NAME_MAX"),
	}
	for name, reason := range map[string]string{
		"RECIPIENT_NAME_MESSAGE":      recipientNameReason,
		"GIFT_NAME_LENGTH_MESSAGE":    giftNameLengthReason,
		"GIFT_MESSAGE_LENGTH_MESSAGE": giftMessageLengthReason,
		"NOTE_LENGTH_MESSAGE":         noteLengthReason,
		"AGREEMENTS_MESSAGE":          agreementsReason,
	} {
		if contract := testkit.MessageConstant(t, rules, name, limits); contract != reason {
			t.Errorf("%s: sozlesme %q, gateway %q", name, contract, reason)
		}
	}
	if contract := testkit.MessageConstant(t, testkit.ReadContract(t, contractAuthPath), "PHONE_MESSAGE", nil); contract != giftPhoneReason {
		t.Errorf("PHONE_MESSAGE: sozlesme %q, gateway %q", contract, giftPhoneReason)
	}
	if contract := testkit.MessageConstant(t, testkit.ReadContract(t, contractOrderPath), "PAYMENT_CARD_MESSAGE", nil); contract != paymentCardReason {
		t.Errorf("PAYMENT_CARD_MESSAGE: sozlesme %q, gateway %q", contract, paymentCardReason)
	}
}

const contractCommonPath = "../../../../packages/contracts/src/common.ts"

func TestCardIDRuleMatchesContract(t *testing.T) {
	// cardIdSchema: `^${ID_PREFIX.CARD}_[0-9a-f]{32}$` ve cumlesi; onek core'dan.
	prefix := testkit.StringRecord(t, testkit.ReadContract(t, testkit.CoreIDPath), "ID_PREFIX")["CARD"]
	match := regexp.MustCompile("export const cardIdSchema = z\\.string\\(\\)\\.regex\\(new RegExp\\(`([^`]*)`\\), \\{\\s*message: '([^']*)',").
		FindStringSubmatch(testkit.ReadContract(t, contractCommonPath))
	if match == nil {
		t.Fatal("cardIdSchema sozlesmede bulunamadi")
	}
	if pattern := strings.ReplaceAll(match[1], "${ID_PREFIX.CARD}", prefix); pattern != cardIDPattern {
		t.Errorf("cardIdSchema: sozlesme %q, gateway %q", pattern, cardIDPattern)
	}
	if match[2] != cardIDReason {
		t.Errorf("cardIdSchema cumlesi: sozlesme %q, gateway %q", match[2], cardIDReason)
	}
}
