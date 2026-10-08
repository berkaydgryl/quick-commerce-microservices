package tracking

import (
	"strings"
	"testing"

	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"
	courierv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/courier/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Courier cevabinin sozlesme denetimi (#179, QA K9 N1/N2): aykiri cevap
// istemciye gitmez, ayrintisiz INTERNAL (500) olur; neden koordinat tasimaz.

// broken, asamanin gecerli cevabini bozar.
func broken(phase courierv1.TrackingPhase, mutate func(*courierv1.GetTrackingResponse)) *courierv1.GetTrackingResponse {
	response := trackingIn(phase)
	mutate(response)
	return response
}

// trackedStatusOf, asamaya uygun siparis durumu (order'in kaydi).
func trackedStatusOf(phase courierv1.TrackingPhase) string {
	switch phase {
	case courierv1.TrackingPhase_TRACKING_PHASE_TO_MARKET:
		return "PREPARING"
	case courierv1.TrackingPhase_TRACKING_PHASE_DELIVERED:
		return "DELIVERED"
	default:
		return "ON_THE_WAY"
	}
}

func TestTrackRejectsResponsesThatBreakTheContract(t *testing.T) {
	toMarket := courierv1.TrackingPhase_TRACKING_PHASE_TO_MARKET
	toCustomer := courierv1.TrackingPhase_TRACKING_PHASE_TO_CUSTOMER
	delivered := courierv1.TrackingPhase_TRACKING_PHASE_DELIVERED
	longRoute := make([]*commonv1.GeoPoint, RouteMaxPoints+1)
	for index := range longRoute {
		longRoute[index] = point(40.99, 29.02)
	}
	// Kuryenin onceki musterinin adresindeki konumu (N1: rotaya girmemeli).
	previousCustomer := point(40.98765, 29.12345)
	for name, response := range map[string]*courierv1.GetTrackingResponse{
		"paket alindi ama konum yok": broken(toCustomer, func(r *courierv1.GetTrackingResponse) { r.Location = nil }),
		"asama belirsiz": broken(toCustomer, func(r *courierv1.GetTrackingResponse) {
			r.Phase = courierv1.TrackingPhase_TRACKING_PHASE_UNSPECIFIED
		}),
		"an yok":            broken(toCustomer, func(r *courierv1.GetTrackingResponse) { r.At = nil }),
		"rota bos":          broken(toCustomer, func(r *courierv1.GetTrackingResponse) { r.Route = nil }),
		"rota 41 nokta":     broken(toCustomer, func(r *courierv1.GetTrackingResponse) { r.Route = longRoute }),
		"market konumu yok": broken(toCustomer, func(r *courierv1.GetTrackingResponse) { r.MarketLocation = nil }),
		"adres konumu yok":  broken(toCustomer, func(r *courierv1.GetTrackingResponse) { r.DeliveryLocation = nil }),
		// N1: rota market -> adres parcasi.
		"rota kurye -> market bacagiyla basliyor": broken(toMarket, func(r *courierv1.GetTrackingResponse) {
			r.Route = append([]*commonv1.GeoPoint{previousCustomer}, r.Route...)
		}),
		"rota adreste bitmiyor": broken(toCustomer, func(r *courierv1.GetTrackingResponse) {
			r.Route = append(r.Route, previousCustomer)
		}),
		"rota sonu adresten yalniz boylamda farkli": broken(toCustomer, func(r *courierv1.GetTrackingResponse) {
			r.Route[len(r.Route)-1] = point(40.995, 29.99)
		}),
		// Kurye kimligi ve adi.
		"kurye kimligi bos":         broken(toCustomer, func(r *courierv1.GetTrackingResponse) { r.CourierId = "" }),
		"kurye kimligi bicimsiz":    broken(toCustomer, func(r *courierv1.GetTrackingResponse) { r.CourierId = "crr_1" }),
		"kurye kimligi baska onek":  broken(toCustomer, func(r *courierv1.GetTrackingResponse) { r.CourierId = "usr_0123456789abcdef0123456789abcdef" }),
		"kurye adi bos":             broken(toCustomer, func(r *courierv1.GetTrackingResponse) { r.CourierName = "" }),
		"kurye adi yalniz bosluk":   broken(toCustomer, func(r *courierv1.GetTrackingResponse) { r.CourierName = " \t " }),
		"kalan yol negatif":         broken(toCustomer, func(r *courierv1.GetTrackingResponse) { r.RemainingMeters = -1 }),
		"tahmin negatif":            broken(toCustomer, func(r *courierv1.GetTrackingResponse) { r.EtaSeconds = -1 }),
		"TO_MARKET tahmin negatif":  broken(toMarket, func(r *courierv1.GetTrackingResponse) { r.EtaSeconds = -1 }),
		"TO_MARKET'ta alma ani var": broken(toMarket, func(r *courierv1.GetTrackingResponse) { r.PickedUpAt = at(5) }),
		// N2: asamanin anlari.
		"TO_MARKET'ta teslim ani var":       broken(toMarket, func(r *courierv1.GetTrackingResponse) { r.DeliveredAt = at(9) }),
		"TO_CUSTOMER'da alma ani yok":       broken(toCustomer, func(r *courierv1.GetTrackingResponse) { r.PickedUpAt = nil }),
		"TO_CUSTOMER'da teslim ani var":     broken(toCustomer, func(r *courierv1.GetTrackingResponse) { r.DeliveredAt = at(9) }),
		"DELIVERED'da alma ani yok":         broken(delivered, func(r *courierv1.GetTrackingResponse) { r.PickedUpAt = nil }),
		"DELIVERED'da teslim ani yok":       broken(delivered, func(r *courierv1.GetTrackingResponse) { r.DeliveredAt = nil }),
		"DELIVERED'da konum yok":            broken(delivered, func(r *courierv1.GetTrackingResponse) { r.Location = nil }),
		"DELIVERED'da kalan yol 0 degil":    broken(delivered, func(r *courierv1.GetTrackingResponse) { r.RemainingMeters = 5 }),
		"DELIVERED'da kalan tahmin 0 degil": broken(delivered, func(r *courierv1.GetTrackingResponse) { r.EtaSeconds = 30 }),
	} {
		t.Run(name, func(t *testing.T) {
			orders := &fakeOrders{status: trackedStatusOf(response.GetPhase())}

			_, err := newService(orders, &fakeCourier{response: response}).Track(t.Context(), testUserID, testOrderID)

			appErr := testkit.AppErrorOf(t, err)
			if appErr.Code != apperror.CodeInternal || apperror.HTTPStatus(appErr.Code) != 500 {
				t.Errorf("INTERNAL (500) bekleniyordu: %v", err)
			}
			if appErr.Details != nil {
				t.Errorf("ic hata ayrinti tasimamali: %v", appErr.Details)
			}
			// Neden gunluge gider: koordinat ve ad tasimaz.
			for _, leak := range []string{"40.9", "29.0", "29.1", "Mehmet"} {
				if strings.Contains(err.Error(), leak) {
					t.Errorf("hata metninde %q var: %v", leak, err)
				}
			}
		})
	}
}

func TestTrackAcceptsValidEdgeResponses(t *testing.T) {
	// Adres marketin kendisiyse rota tek noktadir (sozlesme); TO_MARKET'ta
	// courier konum gonderse de cevap gecerlidir (konum atilir).
	market := point(40.99, 29.02)
	for name, response := range map[string]*courierv1.GetTrackingResponse{
		"tek noktali rota": broken(courierv1.TrackingPhase_TRACKING_PHASE_TO_CUSTOMER, func(r *courierv1.GetTrackingResponse) {
			r.Route, r.MarketLocation, r.DeliveryLocation = []*commonv1.GeoPoint{market}, market, market
		}),
		"rota tam 40 nokta": broken(courierv1.TrackingPhase_TRACKING_PHASE_TO_CUSTOMER, func(r *courierv1.GetTrackingResponse) {
			r.Route = make([]*commonv1.GeoPoint, RouteMaxPoints)
			for index := range r.Route {
				r.Route[index] = point(40.99, 29.02)
			}
			r.Route[RouteMaxPoints-1] = point(40.995, 29.03)
		}),
		"TO_MARKET kalan 0": broken(courierv1.TrackingPhase_TRACKING_PHASE_TO_MARKET, func(r *courierv1.GetTrackingResponse) {
			r.RemainingMeters, r.EtaSeconds = 0, 0
		}),
	} {
		orders := &fakeOrders{status: trackedStatusOf(response.GetPhase())}

		if _, err := newService(orders, &fakeCourier{response: response}).Track(t.Context(), testUserID, testOrderID); err != nil {
			t.Errorf("%s: gecerli cevap reddedildi: %v", name, err)
		}
	}
}
