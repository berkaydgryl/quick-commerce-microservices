package order

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// stubServer, gercek gRPC sunucusunda calisan sahte order. Asil test edilen
// sey istegin ve trailer'in (x-app-error) telden gecip adaptore ulasmasi;
// sahte istemci bunu taklit ederdi.
type stubServer struct {
	orderv1.UnimplementedOrderServiceServer

	draftRequest   *orderv1.CreateDraftOrderRequest
	placeRequest   *orderv1.CreateOrderRequest
	confirmRequest *orderv1.ConfirmPaymentRequest
	getRequest     *orderv1.GetOrderRequest
	cancelRequest  *orderv1.CancelOrderRequest

	draftResponse *orderv1.CreateDraftOrderResponse
	placeResponse *orderv1.CreateOrderResponse
	order         *orderv1.Order

	err     error
	trailer metadata.MD
	// cancelErr ve cancelTrailer yalnizca CancelOrder'i dusurur: "zaten iptal"
	// yolunda ardindan gelen GetOrder basarili olmali (T11.4).
	cancelErr     error
	cancelTrailer metadata.MD
}

// fail, sahte hatayi (ve varsa x-app-error trailer'ini) dondurur.
func (s *stubServer) fail(ctx context.Context) error {
	if s.trailer != nil {
		if err := grpc.SetTrailer(ctx, s.trailer); err != nil {
			return err
		}
	}
	return s.err
}

func (s *stubServer) CreateDraftOrder(ctx context.Context, in *orderv1.CreateDraftOrderRequest) (*orderv1.CreateDraftOrderResponse, error) {
	s.draftRequest = in
	if s.err != nil {
		return nil, s.fail(ctx)
	}
	return s.draftResponse, nil
}

func (s *stubServer) CreateOrder(ctx context.Context, in *orderv1.CreateOrderRequest) (*orderv1.CreateOrderResponse, error) {
	s.placeRequest = in
	if s.err != nil {
		return nil, s.fail(ctx)
	}
	return s.placeResponse, nil
}

func (s *stubServer) ConfirmPayment(ctx context.Context, in *orderv1.ConfirmPaymentRequest) (*orderv1.ConfirmPaymentResponse, error) {
	s.confirmRequest = in
	if s.err != nil {
		return nil, s.fail(ctx)
	}
	return &orderv1.ConfirmPaymentResponse{OrderId: in.GetOrderId(), Status: orderv1.OrderStatus_ORDER_STATUS_PAID}, nil
}

func (s *stubServer) CancelOrder(ctx context.Context, in *orderv1.CancelOrderRequest) (*orderv1.CancelOrderResponse, error) {
	s.cancelRequest = in
	if s.cancelErr != nil {
		if s.cancelTrailer != nil {
			if err := grpc.SetTrailer(ctx, s.cancelTrailer); err != nil {
				return nil, err
			}
		}
		return nil, s.cancelErr
	}
	return &orderv1.CancelOrderResponse{Status: orderv1.OrderStatus_ORDER_STATUS_CANCELLED}, nil
}

func (s *stubServer) GetOrder(ctx context.Context, in *orderv1.GetOrderRequest) (*orderv1.GetOrderResponse, error) {
	s.getRequest = in
	if s.err != nil {
		return nil, s.fail(ctx)
	}
	return &orderv1.GetOrderResponse{Order: s.order}, nil
}

const (
	testTimeout = 500 * time.Millisecond
	orderID     = "ord_db77f4c0e24f49919cc1d78a649c9c94"
)

// startStub, sahte order'i bellek ici gRPC sunucusunda kurar ve adaptoru dondurur.
func startStub(t *testing.T, stub *stubServer) *Service {
	t.Helper()
	conn := testkit.BufconnClient(t, func(server *grpc.Server) {
		orderv1.RegisterOrderServiceServer(server, stub)
	})
	return New(orderv1.NewOrderServiceClient(conn), testTimeout)
}

func reserveInput() ReserveInput {
	return ReserveInput{
		UserID:         "usr_1",
		MarketID:       "mkt_migros-jet-moda",
		Items:          []CartItem{{ProductID: "prd_bulasik-deterjan", Quantity: 2}},
		AddressLine:    "Kadikoy",
		Location:       &rest.GeoPoint{Lat: 40.99, Lng: 29.02},
		ExpectedTotal:  &rest.Money{AmountMinor: 19_360, Currency: "TRY"},
		CouponCode:     "ILK10",
		IdempotencyKey: "anahtar-0001",
	}
}
