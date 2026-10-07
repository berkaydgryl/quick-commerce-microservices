package tracking

import (
	"math"
	"testing"

	courierv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/courier/v1"
)

// Gizlilik kurallari (view.go toTracking): paket alinmadan kurye konumu
// cevaba girmez, varis tahmini dakikaya yukari yuvarlanir ve yuvarlama tasmaz.

func TestTrackToMarketDropsLocationEvenIfCourierSendsIt(t *testing.T) {
	// Gizlilik: paket alinmadan kurye onceki musterinin adresinde olabilir.
	response := trackingIn(courierv1.TrackingPhase_TRACKING_PHASE_TO_MARKET)
	response.Location = point(41.01, 28.97)

	got, err := newService(&fakeOrders{status: "PREPARING"}, &fakeCourier{response: response}).Track(t.Context(), testUserID, testOrderID)

	if err != nil || got.Location != nil {
		t.Errorf("TO_MARKET'ta konum cevaba girmemeli: %+v %v", got.Location, err)
	}
}

func TestTrackRoundsEtaBeforePickup(t *testing.T) {
	// Gizlilik: kalanin saniye saniye azalisi kurye -> market uzakligini ele vermesin.
	for _, tc := range []struct {
		eta  int32
		want int64
	}{{437, 480}, {480, 480}, {1, 60}, {0, 0}} {
		response := trackingIn(courierv1.TrackingPhase_TRACKING_PHASE_TO_MARKET)
		response.EtaSeconds = tc.eta

		got, err := newService(&fakeOrders{status: "PREPARING"}, &fakeCourier{response: response}).Track(t.Context(), testUserID, testOrderID)

		if err != nil || got.EtaSeconds != tc.want {
			t.Errorf("TO_MARKET eta %d -> %d bekleniyordu: %d %v", tc.eta, tc.want, got.EtaSeconds, err)
		}
	}
	// Paket alindiktan sonra yuvarlanmaz.
	response := trackingIn(courierv1.TrackingPhase_TRACKING_PHASE_TO_CUSTOMER)
	response.EtaSeconds = 437
	got, err := newService(&fakeOrders{status: "ON_THE_WAY"}, &fakeCourier{response: response}).Track(t.Context(), testUserID, testOrderID)
	if err != nil || got.EtaSeconds != 437 {
		t.Errorf("TO_CUSTOMER eta yuvarlanmamali: %d %v", got.EtaSeconds, err)
	}
}

func TestTrackEtaRoundingDoesNotOverflow(t *testing.T) {
	// #179 N6: int32 sinirindaki tahmin dakikaya yuvarlaninca negatife donmez.
	// 2147483647 -> 2147483700 (60'in kati); sozlesmede ust sinir yok
	// (contract_test.go), JSON'da sayi olarak cikar.
	response := trackingIn(courierv1.TrackingPhase_TRACKING_PHASE_TO_MARKET)
	response.EtaSeconds = math.MaxInt32

	got, err := newService(&fakeOrders{status: "PREPARING"}, &fakeCourier{response: response}).Track(t.Context(), testUserID, testOrderID)

	const want = int64(2147483700)
	if err != nil || got.EtaSeconds != want {
		t.Errorf("tasmasiz yuvarlama %d bekleniyordu: %d %v", want, got.EtaSeconds, err)
	}
}
