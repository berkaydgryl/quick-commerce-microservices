package tracking

import (
	"context"
	"errors"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"
	courierv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/courier/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

const (
	testOrderID   = "ord_db77f4c0e24f49919cc1d78a649c9c94"
	testUserID    = "usr_0123456789abcdef0123456789abcdef"
	testCourierID = "crr_0123456789abcdef0123456789abcdef"
)

// fakeOrders, order adaptorunun sahte hali: sahiplik ve durum.
type fakeOrders struct {
	status  string
	err     error
	calls   int
	userID  string
	orderID string
}

func (f *fakeOrders) Get(_ context.Context, userID, orderID string) (order.Order, error) {
	f.calls++
	f.userID, f.orderID = userID, orderID
	if f.err != nil {
		return order.Order{}, f.err
	}
	return order.Order{ID: orderID, Status: f.status}, nil
}

// fakeCourier, courier istemcisinin sahte hali.
type fakeCourier struct {
	response *courierv1.GetTrackingResponse
	err      error
	// trailer, hatayla birlikte donen metadata (x-app-error; servisin is hatasi).
	trailer metadata.MD
	calls   int
	request *courierv1.GetTrackingRequest
}

func (f *fakeCourier) GetTracking(_ context.Context, in *courierv1.GetTrackingRequest, opts ...grpc.CallOption) (*courierv1.GetTrackingResponse, error) {
	f.calls++
	f.request = in
	for _, option := range opts {
		if trailer, isTrailer := option.(grpc.TrailerCallOption); isTrailer && f.trailer != nil {
			*trailer.TrailerAddr = f.trailer
		}
	}
	return f.response, f.err
}

func point(lat, lng float64) *commonv1.GeoPoint {
	return &commonv1.GeoPoint{Lat: lat, Lng: lng}
}

func at(minute int) *timestamppb.Timestamp {
	return timestamppb.New(time.Date(2026, 10, 7, 20, minute, 0, 0, time.UTC))
}

// trackingIn, courier'in verilen asamadaki cevabi (contracts kurallariyla).
func trackingIn(phase courierv1.TrackingPhase) *courierv1.GetTrackingResponse {
	response := &courierv1.GetTrackingResponse{
		CourierId:        testCourierID,
		CourierName:      "Mehmet K.",
		Phase:            phase,
		At:               at(10),
		RemainingMeters:  1200,
		EtaSeconds:       420,
		Route:            []*commonv1.GeoPoint{point(40.99, 29.02), point(40.995, 29.03)},
		MarketLocation:   point(40.99, 29.02),
		DeliveryLocation: point(40.995, 29.03),
	}
	switch phase {
	case courierv1.TrackingPhase_TRACKING_PHASE_TO_MARKET:
		response.EtaSeconds = 480
	case courierv1.TrackingPhase_TRACKING_PHASE_TO_CUSTOMER:
		response.Location = point(40.992, 29.025)
		response.PickedUpAt = at(5)
	case courierv1.TrackingPhase_TRACKING_PHASE_DELIVERED:
		response.Location = point(40.995, 29.03)
		response.PickedUpAt = at(5)
		response.DeliveredAt = at(9)
		response.RemainingMeters, response.EtaSeconds = 0, 0
	}
	return response
}

func newService(orders *fakeOrders, courier *fakeCourier) *Service {
	return New(orders, courier, time.Second)
}

func appErrorOf(t *testing.T, err error) *apperror.Error {
	t.Helper()
	var appErr *apperror.Error
	if !errors.As(err, &appErr) {
		t.Fatalf("apperror bekleniyordu: %v", err)
	}
	return appErr
}

func TestTrackPhases(t *testing.T) {
	route := `"route":[{"lat":40.99,"lng":29.02},{"lat":40.995,"lng":29.03}],` +
		`"marketLocation":{"lat":40.99,"lng":29.02},"deliveryLocation":{"lat":40.995,"lng":29.03}`
	courier := `"courier":{"id":"` + testCourierID + `","name":"Mehmet K."}`
	for _, tc := range []struct {
		name   string
		status string
		phase  courierv1.TrackingPhase
		want   string
	}{
		{
			name: "TO_MARKET: konum YOK", status: "PREPARING", phase: courierv1.TrackingPhase_TRACKING_PHASE_TO_MARKET,
			want: `{"orderId":"` + testOrderID + `","status":"PREPARING","phase":"TO_MARKET",` + courier + `,` +
				`"at":"2026-10-07T20:10:00Z","remainingMeters":1200,"etaSeconds":480,` + route + `}`,
		},
		{
			name: "TO_CUSTOMER: konum ve alma ani", status: "ON_THE_WAY", phase: courierv1.TrackingPhase_TRACKING_PHASE_TO_CUSTOMER,
			want: `{"orderId":"` + testOrderID + `","status":"ON_THE_WAY","phase":"TO_CUSTOMER",` + courier + `,` +
				`"location":{"lat":40.992,"lng":29.025},"at":"2026-10-07T20:10:00Z","remainingMeters":1200,"etaSeconds":420,` +
				route + `,"pickedUpAt":"2026-10-07T20:05:00Z"}`,
		},
		{
			name: "DELIVERED: kalan 0, iki an", status: "DELIVERED", phase: courierv1.TrackingPhase_TRACKING_PHASE_DELIVERED,
			want: `{"orderId":"` + testOrderID + `","status":"DELIVERED","phase":"DELIVERED",` + courier + `,` +
				`"location":{"lat":40.995,"lng":29.03},"at":"2026-10-07T20:10:00Z","remainingMeters":0,"etaSeconds":0,` +
				route + `,"pickedUpAt":"2026-10-07T20:05:00Z","deliveredAt":"2026-10-07T20:09:00Z"}`,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			orders := &fakeOrders{status: tc.status}
			courierRPC := &fakeCourier{response: trackingIn(tc.phase)}

			got, err := newService(orders, courierRPC).Track(t.Context(), testUserID, testOrderID)

			if err != nil {
				t.Fatalf("hata beklenmiyordu: %v", err)
			}
			if body := testkit.JSON(t, got); body != tc.want {
				t.Errorf("govde:\n got %s\nwant %s", body, tc.want)
			}
			if orders.userID != testUserID || orders.orderID != testOrderID {
				t.Errorf("sahiplik JWT kullanicisi ve yol kimligiyle sorulmali: %q %q", orders.userID, orders.orderID)
			}
			if courierRPC.request.GetOrderId() != testOrderID {
				t.Errorf("takip yol kimligiyle istenmeli: %q", courierRPC.request.GetOrderId())
			}
		})
	}
}

func TestTrackToMarketDropsLocationEvenIfCourierSendsIt(t *testing.T) {
	// Gizlilik: paket alinmadan kurye onceki musterinin adresinde olabilir.
	response := trackingIn(courierv1.TrackingPhase_TRACKING_PHASE_TO_MARKET)
	response.Location = point(41.01, 28.97)

	got, err := newService(&fakeOrders{status: "PREPARING"}, &fakeCourier{response: response}).Track(t.Context(), testUserID, testOrderID)

	if err != nil || got.Location != nil {
		t.Errorf("TO_MARKET'ta konum cevaba girmemeli: %+v %v", got.Location, err)
	}
}

func TestTrackNotFoundIsTheSameFor404Causes(t *testing.T) {
	// Sahiplik (order'in NOT_FOUND'u, ayrintisiyla), takip edilmeyen durum ve
	// courier'in NOT_FOUND'u (kendi ayrintisiyla) AYNI cevap: kod ve {orderId}.
	want := `{"orderId":"` + testOrderID + `"}`
	for _, tc := range []struct {
		name         string
		orders       *fakeOrders
		courier      *fakeCourier
		courierCalls int
	}{
		{name: "baskasinin siparisi", orders: &fakeOrders{err: apperror.New(apperror.CodeNotFound, map[string]string{"orderId": testOrderID, "x": "y"})}, courier: &fakeCourier{}},
		{name: "iptal edilmis", orders: &fakeOrders{status: "CANCELLED"}, courier: &fakeCourier{}},
		{name: "odenmis, kurye yok", orders: &fakeOrders{status: "PAID"}, courier: &fakeCourier{}},
		{name: "odeme bekleyen", orders: &fakeOrders{status: "AWAITING_PAYMENT"}, courier: &fakeCourier{}},
		{
			name: "takip yok (courier NOT_FOUND)", orders: &fakeOrders{status: "PREPARING"},
			courier: &fakeCourier{err: status.Error(codes.NotFound, "rota yok")}, courierCalls: 1,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := newService(tc.orders, tc.courier).Track(t.Context(), testUserID, testOrderID)

			appErr := appErrorOf(t, err)
			if appErr.Code != apperror.CodeNotFound || testkit.JSON(t, appErr.Details) != want {
				t.Errorf("tek 404 bekleniyordu: %s %s", appErr.Code, testkit.JSON(t, appErr.Details))
			}
			if tc.courier.calls != tc.courierCalls {
				t.Errorf("courier cagrisi %d, beklenen %d", tc.courier.calls, tc.courierCalls)
			}
		})
	}
}

func TestTrackRejectsMalformedIDBeforeAnyCall(t *testing.T) {
	for _, id := range []string{"", "ord_1", "ORD_DB77F4C0E24F49919CC1D78A649C9C94", "crr_db77f4c0e24f49919cc1d78a649c9c94", "ord_db77f4c0e24f49919cc1d78a649c9c94/x"} {
		orders, courierRPC := &fakeOrders{status: "PREPARING"}, &fakeCourier{}

		_, err := newService(orders, courierRPC).Track(t.Context(), testUserID, id)

		appErr := appErrorOf(t, err)
		if appErr.Code != apperror.CodeNotFound || appErr.Details != nil {
			t.Errorf("%q: ayrintisiz 404 bekleniyordu: %s %v", id, appErr.Code, appErr.Details)
		}
		if orders.calls != 0 || courierRPC.calls != 0 {
			t.Errorf("%q: bicimsiz kimlik RPC'ye gitmemeli: %d %d", id, orders.calls, courierRPC.calls)
		}
	}
}

func TestTrackUnavailableIsFailClosed(t *testing.T) {
	t.Run("order'a ulasilamaz: 503, courier'e gidilmez", func(t *testing.T) {
		orders := &fakeOrders{err: &apperror.Error{Code: apperror.CodeServiceUnavailable, Cause: errors.New("order GetOrder: kapali")}}
		courierRPC := &fakeCourier{response: trackingIn(courierv1.TrackingPhase_TRACKING_PHASE_TO_MARKET)}

		_, err := newService(orders, courierRPC).Track(t.Context(), testUserID, testOrderID)

		if appErrorOf(t, err).Code != apperror.CodeServiceUnavailable || courierRPC.calls != 0 {
			t.Errorf("503 ve courier'e gidilmemesi bekleniyordu: %v %d", err, courierRPC.calls)
		}
	})
	t.Run("courier'e ulasilamaz: 503", func(t *testing.T) {
		courierRPC := &fakeCourier{err: status.Error(codes.Unavailable, "baglanti yok")}

		_, err := newService(&fakeOrders{status: "ON_THE_WAY"}, courierRPC).Track(t.Context(), testUserID, testOrderID)

		if appErrorOf(t, err).Code != apperror.CodeServiceUnavailable {
			t.Errorf("503 bekleniyordu: %v", err)
		}
	})
}

func TestTrackRejectsResponsesThatBreakTheContract(t *testing.T) {
	broken := func(phase courierv1.TrackingPhase, mutate func(*courierv1.GetTrackingResponse)) *courierv1.GetTrackingResponse {
		response := trackingIn(phase)
		mutate(response)
		return response
	}
	toCustomer := courierv1.TrackingPhase_TRACKING_PHASE_TO_CUSTOMER
	longRoute := make([]*commonv1.GeoPoint, RouteMaxPoints+1)
	for index := range longRoute {
		longRoute[index] = point(40.99, 29.02)
	}
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
	} {
		_, err := newService(&fakeOrders{status: "ON_THE_WAY"}, &fakeCourier{response: response}).Track(t.Context(), testUserID, testOrderID)

		appErr := appErrorOf(t, err)
		if appErr.Code != apperror.CodeInternal {
			t.Errorf("%s: INTERNAL bekleniyordu: %v", name, err)
		}
		if appErr.Details != nil {
			t.Errorf("%s: ic hata ayrinti tasimamali: %v", name, appErr.Details)
		}
	}
}

func TestTrackRoundsEtaBeforePickup(t *testing.T) {
	// Gizlilik: kalanin saniye saniye azalisi kurye -> market uzakligini ele vermesin.
	for _, tc := range []struct{ eta, want int32 }{{437, 480}, {480, 480}, {1, 60}, {0, 0}} {
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

func TestTrackRenamesCourierValidationFields(t *testing.T) {
	// Courier'in dogrulama hatasindaki siparis kimligi yol parametresinin adiyla doner.
	courierRPC := &fakeCourier{
		err:     status.Error(codes.InvalidArgument, "gecersiz"),
		trailer: metadata.Pairs("x-app-error", `{"code":"VALIDATION_FAILED","message":"x","details":{"orderId":"bicimsiz"}}`),
	}

	_, err := newService(&fakeOrders{status: "PREPARING"}, courierRPC).Track(t.Context(), testUserID, testOrderID)

	appErr := appErrorOf(t, err)
	if appErr.Code != apperror.CodeValidationFailed || testkit.JSON(t, appErr.Details) != `{"id":"bicimsiz"}` {
		t.Errorf("alan adi id olmali: %s %s", appErr.Code, testkit.JSON(t, appErr.Details))
	}
}
