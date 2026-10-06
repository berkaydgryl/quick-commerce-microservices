package cards

import (
	"errors"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// Kart ekleme deneme siniri (K2, QA S1): kart test etmeye (calinti numaralari
// dogrulama ucunda denemek) karsi. Kullanici basina yalnizca BASARISIZ
// dogrulamalar sayilir; IP basina her deneme.
const (
	FailuresPerHour      = 5
	FailuresPerDay       = 20
	AttemptsPerIPPerHour = 30
)

// Outcome, kart ekleme denemesinin sonucu: metrigin etiketi
// (card_verifications_total{result}) ve sayacin girdisi.
type Outcome string

const (
	OutcomeApproved Outcome = "approved"
	// OutcomeDeclined, saglayici karti dogrulamadi (PAYMENT_DECLINED).
	OutcomeDeclined Outcome = "declined"
	// OutcomeInvalid, kasa karti kurala uymaz buldu (numara, CVV ya da son kullanma).
	OutcomeInvalid Outcome = "invalid"
	// OutcomeLimited, deneme siniri asildi; kasaya gidilmedi.
	OutcomeLimited Outcome = "limited"
	// OutcomeOther, ayni kart, dolu kasa, ad ya da kart adi hatasi, kesinti.
	OutcomeOther Outcome = "other"
)

// cardFields, VALIDATION_FAILED'da kart testi sayilan alanlar: numara, CVV ve
// son kullanma. Ad, kart adi ve dolu kasa (cards) sayilmaz.
var cardFields = []string{"number", "cvv", "expiryMonth", "expiryYear"}

// Classify, kasanin cevabini sonuca cevirir.
func Classify(err error) Outcome {
	if err == nil {
		return OutcomeApproved
	}
	var appErr *apperror.Error
	if !errors.As(err, &appErr) {
		return OutcomeOther
	}
	switch appErr.Code {
	case apperror.CodePaymentDeclined:
		return OutcomeDeclined
	case apperror.CodeValidationFailed:
		for _, field := range cardFields {
			if _, found := appErr.Details[field]; found {
				return OutcomeInvalid
			}
		}
	}
	return OutcomeOther
}

// CountsAsFailure, sonuc kullanicinin basarisiz deneme sayacina yazilir mi?
func (o Outcome) CountsAsFailure() bool {
	return o == OutcomeDeclined || o == OutcomeInvalid
}
