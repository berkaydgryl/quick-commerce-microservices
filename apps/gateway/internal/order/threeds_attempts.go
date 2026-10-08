package order

import (
	"errors"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// 3DS yanlis kod siniri (#163, K4): siparisler arasi. Her siparisin 3DS'i kendi
// icinde 3 hak tanir; iptal edip yeniden siparis veren kullanici her seferinde
// yeni 3 hak alirdi (kaba kuvvet). Kullanici ve IP basina YANLIS KOD sayilir
// (dogru kod, sure dolmasi ve saglayiciya ulasilamamasi sayilmaz).
const (
	ThreeDSFailuresPerHour      = 5
	ThreeDSFailuresPerDay       = 10
	ThreeDSFailuresPerIPPerHour = 30
)

// ThreeDSOutcome, 3DS onay denemesinin sonucu: metrigin etiketi
// (threeds_attempts_total{result}) ve sayacin girdisi.
type ThreeDSOutcome string

const (
	ThreeDSSucceeded ThreeDSOutcome = "succeeded"
	// ThreeDSWrongCode, kod yanlis (hak kaldi ya da son hak da bitti).
	ThreeDSWrongCode ThreeDSOutcome = "wrong_code"
	// ThreeDSExpired, dogrulamanin suresi doldu; deneme sayilmaz.
	ThreeDSExpired ThreeDSOutcome = "expired"
	// ThreeDSLimited, deneme siniri asildi; order'a gidilmedi.
	ThreeDSLimited ThreeDSOutcome = "limited"
	// ThreeDSOther, kesinti, bulunamayan siparis ya da baska hata.
	ThreeDSOther ThreeDSOutcome = "other"
)

// threeDSReasonExpired, payment-svc THREEDS_FAILED ayrintisinda kodun
// denenmedigi tek sebep (payment.proto Confirm3DsResponse).
const threeDSReasonExpired = "expired"

// ClassifyThreeDS, order'in ConfirmPayment cevabini sonuca cevirir. THREEDS_FAILED
// sure dolmasi disinda yanlis koddur: "wrong_code", son hakta "attempts_exhausted"
// ve bilinmeyen ya da eksik sebep (sozlesme kayarsa sayac susmasin: fail-closed).
// Basarisiz ya da iptal edilmis siparise gelen istek ORDER_STATE_INVALID alir:
// sayilmaz, kod da denenmez (odenmis siparise yeni anahtarla gelen istek 200).
func ClassifyThreeDS(err error) ThreeDSOutcome {
	if err == nil {
		return ThreeDSSucceeded
	}
	var appErr *apperror.Error
	if !errors.As(err, &appErr) || appErr.Code != apperror.CodeThreedsFailed {
		return ThreeDSOther
	}
	if appErr.Details["reason"] == threeDSReasonExpired {
		return ThreeDSExpired
	}
	return ThreeDSWrongCode
}

// CountsAsFailure, sonuc kullanicinin yanlis kod sayacina yazilir mi?
func (o ThreeDSOutcome) CountsAsFailure() bool {
	return o == ThreeDSWrongCode
}
