// Package inventory, gateway'in inventory-service ile konusan adaptorudur (T8.4).
//
// Sorumlulugu: toplu stok sorgusunu (CheckAvailability, B27) yapmak, cevabi
// sade bir haritaya cevirmek ve servis hatasini apperror'a indirmek. HTTP
// bilmez; stogun urune nasil yazilacagi (kaydi olmayan SKU, servis cevap
// vermezse ne olur) storefront paketinin isidir.
package inventory

import (
	"context"
	"time"

	"google.golang.org/grpc"

	inventoryv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/inventory/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rpc"
)

// service, gunluge giden hata metnindeki servis adi.
const service = "inventory"

// RPC, uretilen istemcinin BU ADAPTORE lazim olan kismi. Arayuz kullanan
// tarafta ve kucuk: testte sahte istemci vermek icin sunucu kurmak gerekmez.
type RPC interface {
	CheckAvailability(ctx context.Context, in *inventoryv1.CheckAvailabilityRequest, opts ...grpc.CallOption) (*inventoryv1.CheckAvailabilityResponse, error)
}

// Service, stok sorgusunun gateway tarafi.
type Service struct {
	rpc     RPC
	timeout time.Duration
}

// New, adaptoru kurar. timeout, TEK bir gRPC cagrisinin ust siniridir. Katalog
// cagrisinin sinirindan KISADIR (GATEWAY_STOCK_TIMEOUT_MS): stok gelmezse urun
// listesi stoksuz doner, uzun beklemek listeyi yavaslatmaktan baska ise yaramaz.
func New(rpc RPC, timeout time.Duration) *Service {
	return &Service{rpc: rpc, timeout: timeout}
}

// Availability, bir marketin sorulan SKU'larinin satilabilir adetleri.
type Availability struct {
	// Quantities, sayaci olan SKU -> satilabilir adet (asla negatif degil).
	Quantities map[string]int32
	// Unknown, bu markette stok kaydi olmayan (ya da bicimi bozuk) SKU'lar.
	Unknown []string
}

// Availability, SKU'larin adetlerini TEK cagriyla sorar (B27). Hata her zaman
// *apperror.Error'dur (rpc.Invoke).
func (s *Service) Availability(ctx context.Context, marketID string, skus []string) (Availability, error) {
	request := &inventoryv1.CheckAvailabilityRequest{MarketId: marketID, Skus: skus}
	response, err := rpc.Invoke(ctx, s.timeout, service, "CheckAvailability", s.rpc.CheckAvailability, request)
	if err != nil {
		return Availability{}, err
	}
	items := response.GetItems()
	quantities := make(map[string]int32, len(items))
	for _, item := range items {
		quantities[item.GetSku()] = item.GetAvailableQuantity()
	}
	return Availability{Quantities: quantities, Unknown: response.GetUnknownSkus()}, nil
}
