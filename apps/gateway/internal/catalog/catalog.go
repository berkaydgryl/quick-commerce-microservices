// Package catalog, gateway'in catalog-service ile konusan adaptorudur.
//
// Sorumlulugu: gRPC cagrisini yapmak, proto mesajini REST sozlesmesindeki
// bicime (@getir/contracts categorySchema) cevirmek ve servis hatasini
// apperror'a indirmek. HTTP bilmez; HTTP katmani da proto bilmez.
package catalog

import (
	"context"
	"time"

	"google.golang.org/grpc"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rpc"
)

// RPC, uretilen istemcinin BU ADAPTORE lazim olan kismi. Arayuz kullanan
// tarafta ve kucuk: testte sahte istemci vermek icin sunucu kurmak gerekmez.
type RPC interface {
	ListCategories(ctx context.Context, in *catalogv1.ListCategoriesRequest, opts ...grpc.CallOption) (*catalogv1.ListCategoriesResponse, error)
	ListNearbyMarkets(ctx context.Context, in *catalogv1.ListNearbyMarketsRequest, opts ...grpc.CallOption) (*catalogv1.ListNearbyMarketsResponse, error)
	GetMarket(ctx context.Context, in *catalogv1.GetMarketRequest, opts ...grpc.CallOption) (*catalogv1.GetMarketResponse, error)
	ListMarketCategories(ctx context.Context, in *catalogv1.ListMarketCategoriesRequest, opts ...grpc.CallOption) (*catalogv1.ListMarketCategoriesResponse, error)
	ListProducts(ctx context.Context, in *catalogv1.ListProductsRequest, opts ...grpc.CallOption) (*catalogv1.ListProductsResponse, error)
	SearchNearby(ctx context.Context, in *catalogv1.SearchNearbyRequest, opts ...grpc.CallOption) (*catalogv1.SearchNearbyResponse, error)
}

// ImageResolver, verideki goreli gorsel yolunu mutlak URL'ye cevirir
// (assets.Resolver). Arayuz kullanan tarafta: test kendi cozumleyicisini verir.
type ImageResolver interface {
	Resolve(path string) string
}

// Service, katalog uclarinin gateway tarafi.
type Service struct {
	rpc     RPC
	timeout time.Duration
	images  ImageResolver
}

// New, adaptoru kurar. timeout, TEK bir gRPC cagrisinin ust siniridir.
func New(rpc RPC, timeout time.Duration, images ImageResolver) *Service {
	return &Service{rpc: rpc, timeout: timeout, images: images}
}

// ListCategories, kategori listesini REST bicimiyle dondurur.
//
// Hata her zaman *apperror.Error'dur: servis hatasi (x-app-error) varsa onun
// kodu, yoksa gRPC durum kodundan turetilen kod.
func (s *Service) ListCategories(ctx context.Context) (CategoryList, error) {
	response, err := rpc.Invoke(ctx, s.timeout, service, "ListCategories", s.rpc.ListCategories, &catalogv1.ListCategoriesRequest{})
	if err != nil {
		return CategoryList{}, err
	}
	return toCategoryList(response.GetCategories(), s.images), nil
}

// service, gunluge giden hata metnindeki servis adi.
const service = "catalog"
