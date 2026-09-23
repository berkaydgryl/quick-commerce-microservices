package catalog

import (
	"context"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"
	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"
)

// productFieldNames, ListProducts dogrulama hatasinda proto -> REST alan adi.
var productFieldNames = map[string]string{
	"query":          "q",
	"page.pageSize":  "pageSize",
	"page.pageToken": "pageToken",
}

// ProductQuery, GET /v1/markets/{marketId}/products filtreleri. Bos metin
// "filtre yok" demektir; PageSize 0 ise servis varsayilani uygular.
//
// Sinir kurallari (arama en az 2 karakter, sayfa boyu kirpma) catalog-service'te
// uygulanir ve hatasi details ile geri gelir; burada TEKRAR yazilmaz, cunku iki
// yerde duran kural bir gun birbirinden ayrilir.
type ProductQuery struct {
	MarketID   string
	CategoryID string
	Query      string
	PageSize   int32
	PageToken  string
}

// MarketProducts, marketin urunleri: o marketin fiyati ile (ADR-15).
//
// Stok (availableQuantity) BUGUN YAZILMAZ: kaynagi inventory-svc'dir ve henuz
// bagli degil. Sozlesmede alan istege baglidir ve yoklugu "stok bilgisi yok"
// demektir (B27 birlestirmesi inventory gelince burada yapilir).
func (s *Service) MarketProducts(ctx context.Context, query ProductQuery) (ProductPage, error) {
	request := &catalogv1.ListProductsRequest{
		MarketId:   query.MarketID,
		CategoryId: query.CategoryID,
		Query:      query.Query,
		Page:       &commonv1.PageRequest{PageSize: query.PageSize, PageToken: query.PageToken},
	}
	response, err := invoke(ctx, s.timeout, "ListProducts", s.rpc.ListProducts, request)
	if err != nil {
		return ProductPage{}, restFieldNames(err, productFieldNames)
	}
	return toProductPage(response, s.images), nil
}
