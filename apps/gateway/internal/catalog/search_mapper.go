package catalog

import (
	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"
)

// SearchResult, genel aramada bir market (@getir/contracts searchResultSchema):
// yakindaki market satiri + arama bilgisi.
//
// NearbyMarket GOMULUDUR: alanlari (market, distanceMeters) JSON'da ust
// duzeye cikar; sozlesmedeki nearbyMarketSchema.extend(...) ile ayni bicim.
// Istemci ayni market kartini kullanir.
type SearchResult struct {
	NearbyMarket
	// MarketNameMatched, market adi sorguyla eslesti; eslestiyse market urunsuz
	// da listelenir ("Market ya da Urun ara"). omitempty YOK: false da bilgidir.
	MarketNameMatched bool `json:"marketNameMatched"`
	// Products, eslesen AKTIF urunlerin ilkleri (en fazla 3). Bos liste [] yazilir.
	Products []Product `json:"products"`
	// TotalProductMatches, bu marketteki toplam eslesen urun; istemci fazlasi
	// icin "+N urun daha" gosterir.
	TotalProductMatches int32 `json:"totalProductMatches"`
}

// SearchResultList, GET /v1/search cevabinin data alani (searchResultListSchema).
type SearchResultList struct {
	Items []SearchResult `json:"items"`
}

func toSearchResultList(results []*catalogv1.MarketSearchResult, images ImageResolver) SearchResultList {
	// Bos liste JSON'da [] olmali, null DEGIL (bkz. toCategoryList).
	items := make([]SearchResult, 0, len(results))
	for _, result := range results {
		items = append(items, SearchResult{
			NearbyMarket:        toNearbyMarket(result.GetMarket(), images),
			MarketNameMatched:   result.GetMarketNameMatched(),
			Products:            toProducts(result.GetOffers(), images),
			TotalProductMatches: result.GetTotalOfferMatches(),
		})
	}
	return SearchResultList{Items: items}
}
