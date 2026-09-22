// Package catalog, gateway'in catalog-service ile konusan adaptorudur.
//
// Sorumlulugu: gRPC cagrisini yapmak, proto mesajini REST sozlesmesindeki
// bicime (@getir/contracts categorySchema) cevirmek ve servis hatasini
// apperror'a indirmek. HTTP bilmez; HTTP katmani da proto bilmez.
package catalog

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// RPC, uretilen istemcinin BU ADAPTORE lazim olan kismi. Arayuz kullanan
// tarafta ve kucuk: testte sahte istemci vermek icin sunucu kurmak gerekmez.
type RPC interface {
	ListCategories(ctx context.Context, in *catalogv1.ListCategoriesRequest, opts ...grpc.CallOption) (*catalogv1.ListCategoriesResponse, error)
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
	// Son tarih cagri basinadir: istemci baglantiyi acik tutsa bile takilan bir
	// servis gateway'in goroutine'ini sonsuza kadar bekletmesin.
	callCtx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	// Servis hatasinin is anlami trailer'daki x-app-error'dadir; toplamazsak
	// her hata yalnizca durum kodundan tahmin edilir.
	var trailer metadata.MD
	response, err := s.rpc.ListCategories(callCtx, &catalogv1.ListCategoriesRequest{}, grpc.Trailer(&trailer))
	if err != nil {
		return CategoryList{}, apperror.FromGRPC(fmt.Errorf("catalog ListCategories: %w", err), trailer)
	}

	return toCategoryList(response.GetCategories(), s.images), nil
}
