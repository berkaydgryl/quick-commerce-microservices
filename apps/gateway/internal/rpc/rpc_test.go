package rpc

import (
	"errors"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

func TestRenameFieldsRenamesKnownAndKeepsOthers(t *testing.T) {
	original := &apperror.Error{
		Code:    apperror.CodeValidationFailed,
		Details: map[string]any{"query": "en az 2 karakter olmali", "marketId": "zorunlu"},
		Cause:   errors.New("servis"),
	}

	err := RenameFields(original, Names(map[string]string{"query": "q"}))

	var renamed *apperror.Error
	if !errors.As(err, &renamed) {
		t.Fatalf("*apperror.Error bekleniyordu: %v", err)
	}
	if renamed.Details["q"] != "en az 2 karakter olmali" || renamed.Details["marketId"] != "zorunlu" {
		t.Errorf("proto adi REST adina donmeli, digerleri kalmali: %v", renamed.Details)
	}
	if _, stale := renamed.Details["query"]; stale {
		t.Errorf("eski ad kalmamali: %v", renamed.Details)
	}
	if !errors.Is(err, original.Cause) || renamed.Code != original.Code {
		t.Error("kod ve asil hata korunmali")
	}
}

func TestRenameFieldsLeavesOtherErrorsUntouched(t *testing.T) {
	plain := errors.New("apperror degil")
	if got := RenameFields(plain, Names(nil)); !errors.Is(got, plain) {
		t.Errorf("apperror olmayan hata oldugu gibi donmeli: %v", got)
	}

	withoutDetails := apperror.New(apperror.CodeValidationFailed, nil)
	if got := RenameFields(withoutDetails, Names(map[string]string{"a": "b"})); got != error(withoutDetails) {
		t.Errorf("ayrintisiz hataya dokunulmamali: %v", got)
	}
}

func TestRenameFieldsKeepsContextDetailsOfOtherErrors(t *testing.T) {
	// NOT_FOUND {orderId} baglamdir, alan hatasi degil: her uctan ayni adla donmeli.
	notFound := &apperror.Error{Code: apperror.CodeNotFound, Details: map[string]any{"orderId": "ord_1"}}

	got := RenameFields(notFound, Names(map[string]string{"orderId": "id"}))

	if got != error(notFound) || notFound.Details["orderId"] != "ord_1" {
		t.Errorf("dogrulama disi hatanin ayrintisi degismemeli: %v", got)
	}
}
