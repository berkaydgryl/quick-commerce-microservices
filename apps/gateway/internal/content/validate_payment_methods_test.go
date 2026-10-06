package content

import (
	"regexp"
	"strings"
	"testing"
)

func TestValidatePaymentMethodsTerms(t *testing.T) {
	welcome := validWelcome(t)
	welcome.PaymentMethods.TermsParagraphs = nil
	expectProblem(t, welcome, "paymentMethods.termsParagraphs bos")

	welcome = validWelcome(t)
	welcome.PaymentMethods.TermsParagraphs = []string{}
	expectProblem(t, welcome, "paymentMethods.termsParagraphs bos")

	welcome = validWelcome(t)
	welcome.PaymentMethods.TermsParagraphs = []string{"Kart numaranin tamami saklanmaz.", "  "}
	expectProblem(t, welcome, "paymentMethods.termsParagraphs[1] bos")
}

func TestParseRejectsMissingTermsParagraphs(t *testing.T) {
	// Anahtar hic yazilmazsa kati cozumleme listeyi bos birakir; dogrulama reddeder.
	raw := regexp.MustCompile(`"termsParagraphs": *\[[^\]]*\],`).ReplaceAllString(validJSON, ``)
	if raw == validJSON {
		t.Fatal("ornek icerikte termsParagraphs bulunamadi")
	}
	_, err := parseWelcome([]byte(raw), testResolver(t))
	if err == nil || !strings.Contains(err.Error(), "paymentMethods.termsParagraphs bos") {
		t.Fatalf("kosul paragraflari olmayan icerik reddedilmeliydi: %v", err)
	}
}
