// Package tracking, kurye takibinin gateway tarafidir (T14.2; GET
// /v1/orders/{id}/tracking, @getir/contracts tracking.ts).
//
// Courier kullaniciyi BILMEZ (courier.proto GetTracking): sahiplik burada,
// courier'e gitmeden ONCE denetlenir. Sira ve kurallar:
//
//  1. Yol kimligi bicimi (ord_ + 32 onaltilik); bicimsiz kimlik RPC'ye gitmez.
//  2. order GetOrder(kimlik, JWT kullanicisi): baskasinin siparisi ve olmayan
//     siparis order'da ayni NOT_FOUND. Her hatada durulur (fail-closed):
//     order'a ulasilamazsa 503, courier'e hic gidilmez.
//  3. Takip yalnizca PREPARING, ON_THE_WAY ve DELIVERED sipariste; iptal ve
//     odeme oncesi siparis 404.
//  4. courier GetTracking: takip yoksa (kurye atanmadi, rota birakildi) 404,
//     ulasilamazsa 503.
//
// Gecerli bicimli kimlikte butun 404'ler AYNI cevaptir (kod ve ayrinti
// {orderId}): sahiplik, durum ve takip yoklugu disaridan ayirt edilemez.
// Bicimsiz kimlik ayrintisiz 404'tur (girdi yankilanmaz; o kimlikte siparis
// olamayacagi icin ayirt edilmesi bir sey sizdirmaz).
//
// GIZLILIK: konum, rota ve adres kisisel veridir. Bu paket gunluge yazmaz;
// hata nedeni (Cause) yalnizca servis, metot ve gRPC durumunu tasir.
package tracking

import (
	"context"
	"errors"
	"time"

	"google.golang.org/grpc"

	courierv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/courier/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rpc"
)

// service, gunluge giden hata metnindeki servis adi.
const service = "courier"

// courierFieldNames, courier'in dogrulama hatasindaki alan -> REST adi: siparis
// kimligi yol parametresidir ("id"; order adaptorunun GetOrder eslemesiyle ayni).
var courierFieldNames = rpc.Names(map[string]string{"orderId": "id"})

// Orders, sahiplik ve durum icin siparis (gercegi order.Service.Get; ayrintisiz).
type Orders interface {
	Get(ctx context.Context, userID, orderID string) (order.Order, error)
}

// CourierRPC, uretilen courier istemcisinin BU PAKETE lazim olan kismi.
type CourierRPC interface {
	GetTracking(ctx context.Context, in *courierv1.GetTrackingRequest, opts ...grpc.CallOption) (*courierv1.GetTrackingResponse, error)
}

// Service, kurye takibi.
type Service struct {
	orders  Orders
	courier CourierRPC
	// timeout, courier cagrisinin ust siniri (order'inki order adaptorunde).
	timeout time.Duration
}

// New, servisi kurar.
func New(orders Orders, courier CourierRPC, timeout time.Duration) *Service {
	return &Service{orders: orders, courier: courier, timeout: timeout}
}

// Track, kullanicinin siparisinin takibi.
func (s *Service) Track(ctx context.Context, userID, orderID string) (Tracking, error) {
	if !ids.Valid(ids.Order, orderID) {
		return Tracking{}, apperror.New(apperror.CodeNotFound, nil)
	}
	found, err := s.orders.Get(ctx, userID, orderID)
	if err != nil {
		return Tracking{}, sameNotFound(err, orderID)
	}
	if !Tracked(found.Status) {
		return Tracking{}, notFound(orderID)
	}
	request := &courierv1.GetTrackingRequest{OrderId: orderID}
	response, err := rpc.Invoke(ctx, s.timeout, service, "GetTracking", s.courier.GetTracking, request)
	if err != nil {
		return Tracking{}, rpc.RenameFields(sameNotFound(err, orderID), courierFieldNames)
	}
	return toTracking(orderID, found.Status, response)
}

// notFound, ucun TEK 404 cevabi (openapi OrderNotFound: ayrinti {orderId}).
func notFound(orderID string) *apperror.Error {
	return apperror.New(apperror.CodeNotFound, map[string]string{"orderId": orderID})
}

// sameNotFound, servisin NOT_FOUND'unu ucun tek 404'une cevirir: servisin
// ayrintisi atilir (order ve courier'in 404'u disaridan ayirt edilemesin),
// neden gunluk icin kalir. Diger hatalar (503 dahil) oldugu gibi gecer.
func sameNotFound(err error, orderID string) error {
	var appErr *apperror.Error
	if errors.As(err, &appErr) && appErr.Code == apperror.CodeNotFound {
		same := notFound(orderID)
		same.Cause = appErr.Cause
		return same
	}
	return err
}
