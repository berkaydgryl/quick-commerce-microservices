package catalog

import (
	"context"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"
	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rpc"
)

// searchFieldNames, SearchNearby dogrulama hatasinda proto -> REST alan adi.
var searchFieldNames = map[string]string{
	"query":        "q",
	"location.lat": "lat",
	"location.lng": "lng",
}

// SearchQuery, GET /v1/search girdisi. Kurallar (arama zorunlu ve 2-64
// karakter, konum araligi) catalog-service'tedir ve hatasi details ile geri
// gelir; burada TEKRAR yazilmaz (bkz. ProductQuery).
type SearchQuery struct {
	Lat   float64
	Lng   float64
	Query string
}

// Search, genel arama (T9.6): konuma hizmet veren marketlerde urun ya da
// market adi. Dahil etme ve siralama kurali catalog-service'tedir (acik
// marketler yakindan uzaga, kapalilar sonda); adaptor yalnizca cagirir ve
// cevirir.
//
// Stok (availableQuantity) BURADA YAZILMAZ: storefront paketi, urunu olan her
// market icin ekler (T8.4 kurallari).
func (s *Service) Search(ctx context.Context, query SearchQuery) (SearchResultList, error) {
	request := &catalogv1.SearchNearbyRequest{
		Location: &commonv1.GeoPoint{Lat: query.Lat, Lng: query.Lng},
		Query:    query.Query,
	}
	response, err := rpc.Invoke(ctx, s.timeout, service, "SearchNearby", s.rpc.SearchNearby, request)
	if err != nil {
		return SearchResultList{}, rpc.RenameFields(err, rpc.Names(searchFieldNames))
	}
	return toSearchResultList(response.GetResults(), s.images), nil
}
