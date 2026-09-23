// Package catalog, gateway'in catalog-service ile konusan adaptorudur.
//
// Sorumlulugu: gRPC cagrisini yapmak, proto mesajini REST sozlesmesindeki
// bicime (@getir/contracts categorySchema) cevirmek ve servis hatasini
// apperror'a indirmek. HTTP bilmez; HTTP katmani da proto bilmez.
package catalog

import (
	"context"
	"errors"
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
	ListNearbyMarkets(ctx context.Context, in *catalogv1.ListNearbyMarketsRequest, opts ...grpc.CallOption) (*catalogv1.ListNearbyMarketsResponse, error)
	GetMarket(ctx context.Context, in *catalogv1.GetMarketRequest, opts ...grpc.CallOption) (*catalogv1.GetMarketResponse, error)
	ListMarketCategories(ctx context.Context, in *catalogv1.ListMarketCategoriesRequest, opts ...grpc.CallOption) (*catalogv1.ListMarketCategoriesResponse, error)
	ListProducts(ctx context.Context, in *catalogv1.ListProductsRequest, opts ...grpc.CallOption) (*catalogv1.ListProductsResponse, error)
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
	response, err := invoke(ctx, s.timeout, "ListCategories", s.rpc.ListCategories, &catalogv1.ListCategoriesRequest{})
	if err != nil {
		return CategoryList{}, err
	}
	return toCategoryList(response.GetCategories(), s.images), nil
}

// unaryCall, uretilen istemcideki tek bir unary metodun imzasi.
type unaryCall[Req, Resp any] func(ctx context.Context, in *Req, opts ...grpc.CallOption) (*Resp, error)

// invoke, her katalog cagrisinin ortak adimlarini TEK yerde yapar: cagri
// basina son tarih, trailer toplama ve hatayi apperror'a indirme. Uc eklemek
// bu adimlari kopyalamayi gerektirmesin diye jeneriktir.
func invoke[Req, Resp any](ctx context.Context, timeout time.Duration, name string, call unaryCall[Req, Resp], request *Req) (*Resp, error) {
	// Son tarih cagri basinadir: istemci baglantiyi acik tutsa bile takilan bir
	// servis gateway'in goroutine'ini sonsuza kadar bekletmesin.
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Servis hatasinin is anlami trailer'daki x-app-error'dadir; toplamazsak
	// her hata yalnizca durum kodundan tahmin edilir.
	var trailer metadata.MD
	response, err := call(callCtx, request, grpc.Trailer(&trailer))
	if err != nil {
		return nil, apperror.FromGRPC(fmt.Errorf("catalog %s: %w", name, err), trailer)
	}
	return response, nil
}

// restFieldNames, servisin dogrulama hatasindaki PROTO alan adlarini istemcinin
// gonderdigi REST parametre adlarina cevirir ("query" -> "q"). Istemci hatayi
// kendi gonderdigi adla gormeli; "query" diye bir parametre gondermedi.
// Eslemesi olmayan alan oldugu gibi kalir. Hata apperror degilse dokunulmaz.
func restFieldNames(err error, names map[string]string) error {
	var appErr *apperror.Error
	if !errors.As(err, &appErr) || len(appErr.Details) == 0 {
		return err
	}
	renamed := make(map[string]string, len(appErr.Details))
	for field, reason := range appErr.Details {
		if restName, ok := names[field]; ok {
			field = restName
		}
		renamed[field] = reason
	}
	return &apperror.Error{Code: appErr.Code, Details: renamed, Cause: appErr.Cause}
}
