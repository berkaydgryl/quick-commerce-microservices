package tracking

import (
	"fmt"
	"slices"

	courierv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/courier/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

// Asama adlari (@getir/contracts trackingPhaseSchema; contract_test.go denetler).
const (
	PhaseToMarket   = "TO_MARKET"
	PhaseToCustomer = "TO_CUSTOMER"
	PhaseDelivered  = "DELIVERED"
)

// Sozlesme sabitleri (@getir/contracts tracking.ts; contract_test.go denetler).
const (
	// RouteMaxPoints, rotanin en cok nokta sayisi (COURIER_ROUTE_MAX_POINTS).
	RouteMaxPoints = 40
	// EtaStepBeforePickupSeconds, paket alinmadan varis tahmininin yukari
	// yuvarlandigi adim (TRACKING_ETA_STEP_BEFORE_PICKUP_SECONDS).
	EtaStepBeforePickupSeconds = 60
)

// trackedStatuses, takibin gosterildigi siparis durumlari
// (@getir/contracts trackedOrderStatusSchema; contract_test.go denetler).
var trackedStatuses = []string{"PREPARING", "ON_THE_WAY", "DELIVERED"}

// Tracked, siparis bu durumda takip edilir mi? Iptal ve odeme oncesi edilmez.
func Tracked(status string) bool {
	return slices.Contains(trackedStatuses, status)
}

// phaseNames, proto asamasi -> sozlesmedeki ad. Esleme ELLE ve TAM:
// UNSPECIFIED ya da yeni bir asama cevabi INTERNAL yapar, istemciye anlamsiz
// deger gitmez.
var phaseNames = map[courierv1.TrackingPhase]string{
	courierv1.TrackingPhase_TRACKING_PHASE_TO_MARKET:   PhaseToMarket,
	courierv1.TrackingPhase_TRACKING_PHASE_TO_CUSTOMER: PhaseToCustomer,
	courierv1.TrackingPhase_TRACKING_PHASE_DELIVERED:   PhaseDelivered,
}

// Courier, takipteki kurye: kimlik ve gosterim adi ("Mehmet K."; gercek kisi degil).
type Courier struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Tracking, GET /v1/orders/{id}/tracking cevabi (@getir/contracts
// orderTrackingSchema; alan adlari ve istege bagli alanlar contract_test.go'da).
type Tracking struct {
	OrderID string `json:"orderId"`
	// Status, order'in kaydi (GetOrder); phase'in birkac saniye gerisinde olabilir.
	Status  string  `json:"status"`
	Phase   string  `json:"phase"`
	Courier Courier `json:"courier"`
	// Location, kuryenin konumu: TO_MARKET'ta YOK (gizlilik; onceki musterinin
	// adresi sizmasin), sonra zorunlu.
	Location        *rest.GeoPoint `json:"location,omitempty"`
	At              string         `json:"at"`
	RemainingMeters int32          `json:"remainingMeters"`
	// EtaSeconds int64: TO_MARKET'ta dakikaya yukari yuvarlama int32 sinirinda
	// tasmasin (#179 N6); sozlesmede tamsayinin ust siniri yok.
	EtaSeconds       int64           `json:"etaSeconds"`
	Route            []rest.GeoPoint `json:"route"`
	MarketLocation   rest.GeoPoint   `json:"marketLocation"`
	DeliveryLocation rest.GeoPoint   `json:"deliveryLocation"`
	PickedUpAt       string          `json:"pickedUpAt,omitempty"`
	DeliveredAt      string          `json:"deliveredAt,omitempty"`
}

// toTracking, courier'in cevabini sozlesmedeki bicime cevirir.
//
// Gizlilik kurallari son kez BURADA uygulanir (cevap istemciye buradan cikar):
// TO_MARKET'ta courier konum gonderse bile cevaba girmez, varis tahmini
// dakikaya yukari yuvarlanir (kalanin saniye saniye azalisi kuryenin markete
// uzakligini ele vermesin) ve kurye adi kisaltilir (ShortCourierName, #183).
// Sozlesmeye aykiri cevap (invariants.go) istemciye gitmez: INTERNAL.
func toTracking(orderID, status string, response *courierv1.GetTrackingResponse) (Tracking, error) {
	phase, known := phaseNames[response.GetPhase()]
	if !known {
		return Tracking{}, internal(fmt.Errorf("bilinmeyen takip asamasi %v", response.GetPhase()))
	}
	if err := contractViolations(phase, response); err != nil {
		return Tracking{}, internal(err)
	}
	var location *rest.GeoPoint
	eta := int64(response.GetEtaSeconds())
	if phase == PhaseToMarket {
		eta = roundUpToStep(eta, EtaStepBeforePickupSeconds)
	} else {
		point := rest.GeoPointFromProto(response.GetLocation())
		location = &point
	}
	route := make([]rest.GeoPoint, 0, len(response.GetRoute()))
	for _, point := range response.GetRoute() {
		route = append(route, rest.GeoPointFromProto(point))
	}
	return Tracking{
		OrderID:          orderID,
		Status:           status,
		Phase:            phase,
		Courier:          Courier{ID: response.GetCourierId(), Name: ShortCourierName(response.GetCourierName())},
		Location:         location,
		At:               rest.TimeText(response.GetAt()),
		RemainingMeters:  response.GetRemainingMeters(),
		EtaSeconds:       eta,
		Route:            route,
		MarketLocation:   rest.GeoPointFromProto(response.GetMarketLocation()),
		DeliveryLocation: rest.GeoPointFromProto(response.GetDeliveryLocation()),
		PickedUpAt:       rest.TimeText(response.GetPickedUpAt()),
		DeliveredAt:      rest.TimeText(response.GetDeliveredAt()),
	}, nil
}

// roundUpToStep, degeri adimin katina yukari yuvarlar (0 ve negatif oldugu gibi
// kalir). int64: int32 sinirindaki tahmin tasip negatife donmez (#179 N6).
func roundUpToStep(value, step int64) int64 {
	if value <= 0 {
		return value
	}
	return (value + step - 1) / step * step
}

// internal, courier'in sozlesmeye uymayan cevabi. Neden gunluge gider ve
// konum TASIMAZ (yalnizca asama ve alan adlari).
func internal(cause error) error {
	return &apperror.Error{Code: apperror.CodeInternal, Cause: fmt.Errorf("courier GetTracking: %w", cause)}
}
