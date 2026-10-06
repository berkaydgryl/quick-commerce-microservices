package cards

import (
	"errors"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

func TestClassifyCountsOnlyDeclinedAndInvalidCards(t *testing.T) {
	cases := []struct {
		name  string
		err   error
		want  Outcome
		count bool
	}{
		{"basari", nil, OutcomeApproved, false},
		{"saglayici reddi", apperror.New(apperror.CodePaymentDeclined, map[string]string{"reason": "verification_declined"}), OutcomeDeclined, true},
		{"numara", apperror.New(apperror.CodeValidationFailed, map[string]string{"number": "x"}), OutcomeInvalid, true},
		{"cvv", apperror.New(apperror.CodeValidationFailed, map[string]string{"cvv": "x"}), OutcomeInvalid, true},
		{"gecmis kart", apperror.New(apperror.CodeValidationFailed, map[string]string{"expiryMonth": "x"}), OutcomeInvalid, true},
		{"ad", apperror.New(apperror.CodeValidationFailed, map[string]string{"holderName": "x"}), OutcomeOther, false},
		{"dolu kasa", apperror.New(apperror.CodeValidationFailed, map[string]string{"cards": "x"}), OutcomeOther, false},
		{"ayni kart", apperror.New(apperror.CodeConflict, map[string]string{"cardId": "crd_x"}), OutcomeOther, false},
		{"kesinti", apperror.New(apperror.CodeServiceUnavailable, nil), OutcomeOther, false},
		{"apperror degil", errors.New("x"), OutcomeOther, false},
	}
	for _, tc := range cases {
		got := Classify(tc.err)
		if got != tc.want || got.CountsAsFailure() != tc.count {
			t.Errorf("%s: %s (sayilir %v), beklenen %s (sayilir %v)", tc.name, got, got.CountsAsFailure(), tc.want, tc.count)
		}
	}
}
