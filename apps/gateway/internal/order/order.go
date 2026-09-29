// Package order, gateway'in order-service ile konusan adaptorudur (T7.5).
//
// Sorumlulugu: HTTP katmanindan gelen sade girdiyi proto istegine cevirmek,
// gRPC cagrisini yapmak (internal/rpc), cevabi REST sozlesmesindeki bicime
// (@getir/contracts cart.ts ve order.ts) cevirmek ve servisin dogrulama
// hatasindaki proto alan adlarini istemcinin gonderdigi REST adlarina
// cevirmek. HTTP bilmez; HTTP katmani da proto bilmez.
//
// Is kurali YOKTUR: fiyat, risk, 3DS ve durum gecisleri order-service'tedir.
package order

import (
	"context"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"
	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"
	paymentv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/payment/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rpc"
)

// service, gunluge giden hata metnindeki servis adi.
const service = "order"

// RPC, uretilen istemcinin BU ADAPTORE lazim olan kismi. Arayuz kullanan
// tarafta ve kucuk: testte sahte istemci vermek icin sunucu kurmak gerekmez.
type RPC interface {
	CreateDraftOrder(ctx context.Context, in *orderv1.CreateDraftOrderRequest, opts ...grpc.CallOption) (*orderv1.CreateDraftOrderResponse, error)
	CreateOrder(ctx context.Context, in *orderv1.CreateOrderRequest, opts ...grpc.CallOption) (*orderv1.CreateOrderResponse, error)
	ConfirmPayment(ctx context.Context, in *orderv1.ConfirmPaymentRequest, opts ...grpc.CallOption) (*orderv1.ConfirmPaymentResponse, error)
	GetOrder(ctx context.Context, in *orderv1.GetOrderRequest, opts ...grpc.CallOption) (*orderv1.GetOrderResponse, error)
}

// Service, siparis uclarinin gateway tarafi.
type Service struct {
	rpc     RPC
	timeout time.Duration
}

// New, adaptoru kurar. timeout, TEK bir gRPC cagrisinin ust siniridir; order
// kendi icinde risk (1 sn) ve odeme (3 sn) cagirir, bu sinir onlardan uzun olmali.
func New(rpc RPC, timeout time.Duration) *Service {
	return &Service{rpc: rpc, timeout: timeout}
}

// Reserve, sepeti taslak siparise cevirir (POST /v1/cart/reserve ->
// CreateDraftOrder). Stok bugun kilitlenmez (T11.2); cevapta expiresAt yoktur.
func (s *Service) Reserve(ctx context.Context, in ReserveInput) (Reservation, error) {
	lines := make([]*orderv1.CartLine, 0, len(in.Items))
	for _, item := range in.Items {
		// sku BILEREK bos: REST sepeti tasimaz, order onu catalog'dan alir (T7.5).
		lines = append(lines, &orderv1.CartLine{ProductId: item.ProductID, Quantity: item.Quantity})
	}
	request := &orderv1.CreateDraftOrderRequest{
		UserId:          in.UserID,
		MarketId:        in.MarketID,
		Lines:           lines,
		DeliveryAddress: in.AddressLine,
		IdempotencyKey:  in.IdempotencyKey,
		CouponCode:      in.CouponCode,
	}
	// Gonderilmeyen konum ve tutar mesaj olarak da GONDERILMEZ: servis onlari
	// "zorunlu" diye reddeder. Bos mesaj gondermek (0,0) konumunu ve 0 TL'yi
	// gecerli deger gibi tasirdi.
	if in.Location != nil {
		request.DeliveryLocation = &commonv1.GeoPoint{Lat: in.Location.Lat, Lng: in.Location.Lng}
	}
	if in.ExpectedTotal != nil {
		request.ExpectedTotal = &commonv1.Money{AmountMinor: in.ExpectedTotal.AmountMinor, Currency: in.ExpectedTotal.Currency}
	}

	response, err := rpc.Invoke(ctx, s.timeout, service, "CreateDraftOrder", s.rpc.CreateDraftOrder, request)
	if err != nil {
		return Reservation{}, rpc.RenameFields(err, reserveFieldNames)
	}
	return toReservation(response)
}

// Place, taslagi siparise cevirir (POST /v1/orders -> CreateOrder): risk,
// odeme ve gerekirse 3DS bekleyisi order'in saga'sidir.
func (s *Service) Place(ctx context.Context, in PlaceInput) (Placement, error) {
	request := &orderv1.CreateOrderRequest{
		OrderId: in.OrderID,
		UserId:  in.UserID,
		// REST yuzeyinde tek yontem kart (contracts paymentMethodSchema).
		PaymentMethod:  paymentv1.PaymentMethod_PAYMENT_METHOD_CARD,
		CardToken:      in.CardToken,
		IdempotencyKey: in.IdempotencyKey,
		// Risk sinyalleri istemciden ALINMAZ (B9): IP baglantidan, digerleri
		// oturum ve kullanici kaydindan (T8.1).
		Signals: toProtoSignals(in.Signals),
	}

	response, err := rpc.Invoke(ctx, s.timeout, service, "CreateOrder", s.rpc.CreateOrder, request)
	if err != nil {
		return Placement{}, rpc.RenameFields(err, placeFieldNames)
	}
	return toPlacement(response.GetOrderId(), response.GetStatus(), response.GetChallengeId())
}

// ConfirmThreeDS, 3DS kodunu dogrular (POST /v1/orders/{id}/3ds -> ConfirmPayment).
func (s *Service) ConfirmThreeDS(ctx context.Context, in ConfirmInput) (Placement, error) {
	request := &orderv1.ConfirmPaymentRequest{
		OrderId:        in.OrderID,
		UserId:         in.UserID,
		ChallengeId:    in.ChallengeID,
		Code:           in.Code,
		IdempotencyKey: in.IdempotencyKey,
	}

	response, err := rpc.Invoke(ctx, s.timeout, service, "ConfirmPayment", s.rpc.ConfirmPayment, request)
	if err != nil {
		return Placement{}, rpc.RenameFields(err, confirmFieldNames)
	}
	return toPlacement(response.GetOrderId(), response.GetStatus(), "")
}

// Get, kullanicinin tek siparisi (GET /v1/orders/{id} -> GetOrder).
// Baskasinin siparisi NOT_FOUND doner (varlik bilgisi bile sizmaz; order-service).
func (s *Service) Get(ctx context.Context, userID, orderID string) (Order, error) {
	request := &orderv1.GetOrderRequest{OrderId: orderID, UserId: userID}

	response, err := rpc.Invoke(ctx, s.timeout, service, "GetOrder", s.rpc.GetOrder, request)
	if err != nil {
		return Order{}, rpc.RenameFields(err, getFieldNames)
	}
	return toOrder(response.GetOrder())
}

// toProtoSignals, sinyalleri proto'ya cevirir. Bilinmeyen konum ve hesap yasi
// gonderilmez (mesaj alani yok = bilinmiyor); bos metin ve 0 sayi zaten
// sozlesmede "yok" demektir.
func toProtoSignals(signals Signals) *orderv1.CheckoutSignals {
	out := &orderv1.CheckoutSignals{
		IpAddress:         signals.IPAddress,
		IpCity:            signals.IPCity,
		DeviceId:          signals.DeviceID,
		AccountsOnDevice:  signals.AccountsOnDevice,
		PreviousIpAddress: signals.PreviousIPAddress,
	}
	if signals.SessionLocation != nil {
		out.SessionLocation = &commonv1.GeoPoint{Lat: signals.SessionLocation.Lat, Lng: signals.SessionLocation.Lng}
	}
	if !signals.AccountCreatedAt.IsZero() {
		out.AccountCreatedAt = timestamppb.New(signals.AccountCreatedAt)
	}
	return out
}
