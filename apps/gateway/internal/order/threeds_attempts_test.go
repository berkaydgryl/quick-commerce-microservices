package order

import (
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// threeDSFailed, payment-svc'nin order uzerinden gelen 3DS reddi (x-app-error'dan
// cozulmus hali: sayilar float64).
func threeDSFailed(reason string) error {
	return &apperror.Error{
		Code:    apperror.CodeThreedsFailed,
		Details: map[string]any{"attemptsLeft": float64(1), "reason": reason},
	}
}

func TestClassifyThreeDSCountsOnlyWrongCodes(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want ThreeDSOutcome
	}{
		{"dogru kod", nil, ThreeDSSucceeded},
		{"yanlis kod, hak kaldi", threeDSFailed("wrong_code"), ThreeDSWrongCode},
		{"son hak da yanlis", threeDSFailed("attempts_exhausted"), ThreeDSWrongCode},
		{"sure doldu", threeDSFailed("expired"), ThreeDSExpired},
		{"bilinmeyen sebep (fail-closed)", threeDSFailed("baska"), ThreeDSWrongCode},
		{"sebepsiz ret (fail-closed)", &apperror.Error{Code: apperror.CodeThreedsFailed}, ThreeDSWrongCode},
		{"saglayiciya ulasilamadi", apperror.New(apperror.CodeServiceUnavailable, nil), ThreeDSOther},
		{"siparis yok", apperror.New(apperror.CodeNotFound, nil), ThreeDSOther},
		{"apperror olmayan hata", errors.New("baglanti koptu"), ThreeDSOther},
	}
	for _, tc := range cases {
		got := ClassifyThreeDS(tc.err)
		if got != tc.want {
			t.Errorf("%s: %q, beklenen %q", tc.name, got, tc.want)
		}
		if got.CountsAsFailure() != (tc.want == ThreeDSWrongCode) {
			t.Errorf("%s: sayaca yazilma %v", tc.name, got.CountsAsFailure())
		}
	}
}

func TestThreeDSLimitsMatchDecisionK4(t *testing.T) {
	// K4 (#163, onayli): yanlis kod kullanici basina saatte 5 / gunde 10, IP basina saatte 30.
	got := [3]int{ThreeDSFailuresPerHour, ThreeDSFailuresPerDay, ThreeDSFailuresPerIPPerHour}
	if got != [3]int{5, 10, 30} {
		t.Errorf("3DS esikleri %v, karar K4 [5 10 30]", got)
	}
}

// paymentProtoPath, 3DS reddinin sebeplerini belgeleyen sozlesme.
const paymentProtoPath = "../../../../packages/proto/proto/getir/payment/v1/payment.proto"

func TestThreeDSReasonsMatchPaymentContract(t *testing.T) {
	// payment-svc sebep metnini degistirirse sayac sessizce saymayi birakirdi.
	raw, err := os.ReadFile(paymentProtoPath)
	if err != nil {
		t.Fatalf("sozlesme okunamadi: %v", err)
	}
	for _, reason := range []string{"wrong_code", "attempts_exhausted", threeDSReasonExpired} {
		if !strings.Contains(string(raw), `reason "`+reason+`"`) {
			t.Errorf("payment.proto %q sebebini belgelemiyor", reason)
		}
	}
}
