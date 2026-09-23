package catalog

import (
	"context"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"
	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// Pazaryeri uclari (ADR-15): konuma hizmet veren marketler, market sayfasi
// basligi ve marketin teklifi olan kategoriler. Kurallar (yaricap, kapali
// market, olmayan market -> NOT_FOUND) catalog-service'tedir; adaptor yalnizca
// cagirir ve cevirir.

// locationFieldNames, ListNearbyMarkets dogrulama hatasinda proto -> REST alan adi.
var locationFieldNames = map[string]string{
	"location.lat": "lat",
	"location.lng": "lng",
}

// NearbyMarkets, konumu kapsayan marketleri yakindan uzaga dondurur. Hic
// market yoksa BOS liste doner, hata degil ("bolgende market yok").
func (s *Service) NearbyMarkets(ctx context.Context, lat, lng float64) (NearbyMarketList, error) {
	request := &catalogv1.ListNearbyMarketsRequest{Location: &commonv1.GeoPoint{Lat: lat, Lng: lng}}
	response, err := invoke(ctx, s.timeout, "ListNearbyMarkets", s.rpc.ListNearbyMarkets, request)
	if err != nil {
		return NearbyMarketList{}, restFieldNames(err, locationFieldNames)
	}
	return toNearbyMarketList(response.GetMarkets(), s.images), nil
}

// Market, market sayfasinin basligi (puan, sure, fiyat kurallari).
func (s *Service) Market(ctx context.Context, marketID string) (Market, error) {
	request := &catalogv1.GetMarketRequest{MarketId: marketID}
	response, err := invoke(ctx, s.timeout, "GetMarket", s.rpc.GetMarket, request)
	if err != nil {
		return Market{}, err
	}
	// Basarili cevapta market bos gelirse servis sozlesmeyi bozmustur; bos bir
	// market ("id": "") istemciye gecerli veri gibi gitmemeli.
	if response.GetMarket() == nil {
		return Market{}, apperror.New(apperror.CodeInternal, nil)
	}
	return toMarket(response.GetMarket(), s.images), nil
}

// MarketCategories, marketin teklifi olan kategoriler (manav yalnizca meyve-sebze).
func (s *Service) MarketCategories(ctx context.Context, marketID string) (CategoryList, error) {
	request := &catalogv1.ListMarketCategoriesRequest{MarketId: marketID}
	response, err := invoke(ctx, s.timeout, "ListMarketCategories", s.rpc.ListMarketCategories, request)
	if err != nil {
		return CategoryList{}, err
	}
	return toCategoryList(response.GetCategories(), s.images), nil
}
