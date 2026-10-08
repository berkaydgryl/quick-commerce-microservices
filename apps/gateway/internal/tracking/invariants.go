package tracking

import (
	"errors"
	"fmt"
	"strings"

	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"
	courierv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/courier/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// contractViolations, courier cevabinin sozlesmeye (@getir/contracts
// orderTrackingSchema ve enforceTrackingPhase) aykiriliklari. Cevap istemciye
// buradan cikar: aykiri govde gitmez, 500 olur (#179, QA K9 N1/N2).
//
//   - zorunlu alanlar: an, 1-40 noktali rota, market ve adres konumu; kurye
//     kimligi (crr_) ve gosterim adi dolu; kalan yol ve tahmin negatif degil
//   - rota market -> adres parcasidir: ilk nokta market, son nokta adres. Paket
//     alinmadan (TO_MARKET) rotaya kurye -> market bacagi girerse kuryenin
//     onceki musterinin adresindeki konumu sizardi (gizlilik)
//   - asamanin anlari: TO_MARKET'ta alma ve teslim ani yok; TO_CUSTOMER'da alma
//     ani var, teslim ani yok; DELIVERED'da ikisi var, kalan yol ve tahmin 0;
//     paket alindiktan sonra kurye konumu zorunlu
//
// Hata yalnizca alan ADLARINI ve sayilari tasir: koordinat, ad gunluge gitmez.
func contractViolations(phase string, response *courierv1.GetTrackingResponse) error {
	return errors.Join(append(requiredParts(response), phaseRules(phase, response)...)...)
}

// requiredParts, asamadan bagimsiz zorunlu alanlar ve rota uclari.
func requiredParts(response *courierv1.GetTrackingResponse) []error {
	var violations []error
	if !ids.Valid(ids.Courier, response.GetCourierId()) {
		violations = append(violations, errors.New("kurye kimligi gecersiz"))
	}
	// Yalniz bosluktan olusan ad kisaltilinca bos kalirdi (sozlesme: min 1).
	if strings.TrimSpace(response.GetCourierName()) == "" {
		violations = append(violations, errors.New("kurye adi bos"))
	}
	if response.GetAt() == nil {
		violations = append(violations, errors.New("an yok"))
	}
	if response.GetRemainingMeters() < 0 || response.GetEtaSeconds() < 0 {
		violations = append(violations, errors.New("kalan yol ya da tahmin negatif"))
	}
	route := response.GetRoute()
	if len(route) == 0 || len(route) > RouteMaxPoints {
		violations = append(violations, fmt.Errorf("rota %d nokta", len(route)))
	}
	market, delivery := response.GetMarketLocation(), response.GetDeliveryLocation()
	if market == nil || delivery == nil {
		violations = append(violations, errors.New("market ya da adres konumu yok"))
	} else if len(route) > 0 && (!samePoint(route[0], market) || !samePoint(route[len(route)-1], delivery)) {
		violations = append(violations, errors.New("rota market -> adres parcasi degil"))
	}
	return violations
}

// samePoint, iki noktanin enlem ve boylami ayni mi? Courier market ve adres
// konumunu rotanin uclarindan uretir (ayni deger): esitlik TAMDIR. proto.Equal
// degil: GeoPoint'e eklenecek bir alan (ornegin dogruluk) ya da bilinmeyen
// alan eslesmeyi bozup her takibi 500 yapmasin.
func samePoint(a, b *commonv1.GeoPoint) bool {
	return a.GetLat() == b.GetLat() && a.GetLng() == b.GetLng()
}

// phaseRules, asamanin anlari, kalanlari ve kurye konumu.
func phaseRules(phase string, response *courierv1.GetTrackingResponse) []error {
	var violations []error
	pickedUp, delivered := response.GetPickedUpAt() != nil, response.GetDeliveredAt() != nil
	if (phase != PhaseToMarket) != pickedUp {
		violations = append(violations, fmt.Errorf("%s asamasinda alma ani tutarsiz", phase))
	}
	if (phase == PhaseDelivered) != delivered {
		violations = append(violations, fmt.Errorf("%s asamasinda teslim ani tutarsiz", phase))
	}
	if phase != PhaseToMarket && response.GetLocation() == nil {
		violations = append(violations, fmt.Errorf("%s asamasinda kurye konumu yok", phase))
	}
	if phase == PhaseDelivered && (response.GetRemainingMeters() != 0 || response.GetEtaSeconds() != 0) {
		violations = append(violations, errors.New("teslim edildi ama kalan yol ya da tahmin 0 degil"))
	}
	return violations
}
