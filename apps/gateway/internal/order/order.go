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
	"errors"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"
	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"
	paymentv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/payment/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
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
	CancelOrder(ctx context.Context, in *orderv1.CancelOrderRequest, opts ...grpc.CallOption) (*orderv1.CancelOrderResponse, error)
	ListMyOrders(ctx context.Context, in *orderv1.ListMyOrdersRequest, opts ...grpc.CallOption) (*orderv1.ListMyOrdersResponse, error)
}

// cancelledStatus, order'in ORDER_STATE_INVALID ayrintisindaki "zaten iptal"
// durumu (CancelOrder: details.status, domain adi).
const cancelledStatus = "CANCELLED"

// Service, siparis uclarinin gateway tarafi.
type Service struct {
	rpc     RPC
	timeout time.Duration
	// now, geri sayimin (ttlSeconds) ve birakma aninin saati; testte sabitlenir.
	now func() time.Time
}

// New, adaptoru kurar. timeout, TEK bir gRPC cagrisinin ust siniridir; order
// kendi icinde risk (1 sn) ve odeme (3 sn) cagirir, bu sinir onlardan uzun olmali.
func New(rpc RPC, timeout time.Duration) *Service {
	return &Service{rpc: rpc, timeout: timeout, now: time.Now}
}

// Reserve, sepeti taslak siparise cevirir (POST /v1/cart/reserve ->
// CreateDraftOrder). Stok taslakta kilitlenir (T11.2): cevapta bitis ani ve
// kalan saniye (T11.4).
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
	return toReservation(response, s.now())
}

// Release, rezervasyonu birakir (DELETE /v1/cart/reserve/{orderId} ->
// CancelOrder, T11.4): taslak ya da odeme bekleyen siparis iptal edilir, stok
// doner. Kurallar order'dadir: parasi alinmissa REQUEST_IN_PROGRESS, odenmis
// ya da baska son durumdaki siparis ORDER_STATE_INVALID, baskasinin siparisi
// NOT_FOUND.
//
// Zaten iptal edilmis siparis (kullanici iptali ya da suresi dolup supurulmus)
// HATA DEGIL: released false ve iptal ani (siparisin son guncellenmesi). Istek
// tekrar guvenlidir; farkli Idempotency-Key ile gelse de ayni cevabi alir.
func (s *Service) Release(ctx context.Context, in ReleaseInput) (ReservationRelease, error) {
	request := &orderv1.CancelOrderRequest{
		OrderId:        in.OrderID,
		UserId:         in.UserID,
		IdempotencyKey: in.IdempotencyKey,
	}

	_, err := rpc.Invoke(ctx, s.timeout, service, "CancelOrder", s.rpc.CancelOrder, request)
	if err == nil {
		return ReservationRelease{
			OrderID:    in.OrderID,
			Released:   true,
			ReleasedAt: s.now().UTC().Format(time.RFC3339Nano),
		}, nil
	}
	if !alreadyCancelled(err) {
		return ReservationRelease{}, rpc.RenameFields(err, releaseFieldNames)
	}

	found, err := s.Get(ctx, in.UserID, in.OrderID)
	if err != nil {
		return ReservationRelease{}, err
	}
	releasedAt := found.UpdatedAt
	if releasedAt == "" {
		releasedAt = found.CreatedAt
	}
	return ReservationRelease{OrderID: in.OrderID, Released: false, ReleasedAt: releasedAt}, nil
}

// alreadyCancelled, iptal edilemedi cunku siparis ZATEN iptal: order'in
// ORDER_STATE_INVALID hatasi, ayrintida status CANCELLED.
func alreadyCancelled(err error) bool {
	var appErr *apperror.Error
	if !errors.As(err, &appErr) || appErr.Code != apperror.CodeOrderStateInvalid {
		return false
	}
	status, isText := appErr.Details["status"].(string)
	return isText && status == cancelledStatus
}

// Place, taslagi siparise cevirir (POST /v1/orders -> CreateOrder): risk,
// odeme ve gerekirse 3DS bekleyisi order'in saga'sidir.
func (s *Service) Place(ctx context.Context, in PlaceInput) (Placement, error) {
	request := &orderv1.CreateOrderRequest{
		OrderId: in.OrderID,
		UserId:  in.UserID,
		// REST yuzeyinde tek yontem kart (contracts paymentMethodSchema).
		PaymentMethod:  paymentv1.PaymentMethod_PAYMENT_METHOD_CARD,
		CardId:         in.CardID,
		CardToken:      in.CardToken,
		IdempotencyKey: in.IdempotencyKey,
		Details:        toProtoDetails(in.Details),
		// Risk sinyalleri istemciden ALINMAZ (B9): IP baglantidan, digerleri
		// oturum ve kullanici kaydindan (T8.1).
		Signals: toProtoSignals(in.Signals),
	}

	response, err := rpc.Invoke(ctx, s.timeout, service, "CreateOrder", s.rpc.CreateOrder, request)
	if err != nil {
		return Placement{}, rpc.RenameFields(err, placeFieldNames)
	}
	return toPlacement(response.GetOrderId(), response.GetStatus(), challengeOf(response, s.now()))
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
	return toPlacement(response.GetOrderId(), response.GetStatus(), nil)
}

// Get, kullanicinin tek siparisi (GetOrder), AYRINTISIZ: sahiplik denetimi
// (oda jetonu) ve "zaten iptal" yolu bunu kullanir. Baskasinin siparisi
// NOT_FOUND doner (varlik bilgisi bile sizmaz; order-service).
func (s *Service) Get(ctx context.Context, userID, orderID string) (Order, error) {
	raw, err := s.fetch(ctx, userID, orderID)
	if err != nil {
		return Order{}, err
	}
	return toOrder(raw, s.now())
}

// GetDetailed, GET /v1/orders/{id}: siparis ve ayrintisi (T12.4), SAHIBINE.
// Ayrinti yalnizca bu cevap tipinde vardir; liste (Page) ve Get onu tasiyamaz.
func (s *Service) GetDetailed(ctx context.Context, userID, orderID string) (OrderDetail, error) {
	raw, err := s.fetch(ctx, userID, orderID)
	if err != nil {
		return OrderDetail{}, err
	}
	found, err := toOrder(raw, s.now())
	if err != nil {
		return OrderDetail{}, err
	}
	details, err := toDetailsView(raw.GetDetails())
	if err != nil {
		return OrderDetail{}, err
	}
	return OrderDetail{Order: found, Details: details}, nil
}

func (s *Service) fetch(ctx context.Context, userID, orderID string) (*orderv1.Order, error) {
	request := &orderv1.GetOrderRequest{OrderId: orderID, UserId: userID}
	response, err := rpc.Invoke(ctx, s.timeout, service, "GetOrder", s.rpc.GetOrder, request)
	if err != nil {
		return nil, rpc.RenameFields(err, getFieldNames)
	}
	return response.GetOrder(), nil
}

// OrderPage, kullanicinin siparislerinin bir sayfasi, yeniden eskiye (ham:
// taslaklar dahil). Gecmis Siparislerim'in suzmesi orderhistory'dedir.
type OrderPage struct {
	Orders []Order
	// Bos ise liste bitmistir.
	NextPageToken string
}

// Page, kullanicinin siparislerinin bir sayfasi (T11.16; ListMyOrders).
// pageSize 0 ise order varsayilani; ust sinir order'dadir. Cozulemeyen
// jeton VALIDATION_FAILED (pageToken).
func (s *Service) Page(ctx context.Context, userID string, pageSize int32, pageToken string) (OrderPage, error) {
	request := &orderv1.ListMyOrdersRequest{
		UserId: userID,
		Page:   &commonv1.PageRequest{PageSize: pageSize, PageToken: pageToken},
	}
	response, err := rpc.Invoke(ctx, s.timeout, service, "ListMyOrders", s.rpc.ListMyOrders, request)
	if err != nil {
		return OrderPage{}, rpc.RenameFields(err, listFieldNames)
	}
	now := s.now()
	orders := make([]Order, 0, len(response.GetOrders()))
	for _, raw := range response.GetOrders() {
		mapped, err := toOrder(raw, now)
		if err != nil {
			return OrderPage{}, err
		}
		orders = append(orders, mapped)
	}
	return OrderPage{Orders: orders, NextPageToken: response.GetPage().GetNextPageToken()}, nil
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
