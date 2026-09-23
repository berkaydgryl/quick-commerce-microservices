package catalog

import (
	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"
	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"
)

// defaultCurrency, proto'da bos para birimi TRY demektir; REST sozlesmesi
// (moneySchema) ise alani acikca "TRY" ister.
const defaultCurrency = "TRY"

// ratingScale, proto puani onda bir birimle tam sayi tasir (47 = 4.7).
// Float'u telde tasimamak yuvarlama farkini onler; ondaliga cevrim tek yerde.
const ratingScale = 10.0

// Money, kurus cinsinden tutar (@getir/contracts moneySchema). Float yok.
type Money struct {
	AmountMinor int64  `json:"amountMinor"`
	Currency    string `json:"currency"`
}

// GeoPoint, WGS84 koordinati.
type GeoPoint struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// DeliveryTime, tahmini teslimat araligi (dakika).
type DeliveryTime struct {
	MinMinutes int32 `json:"minMinutes"`
	MaxMinutes int32 `json:"maxMinutes"`
}

// Rating, puan ortalamasi (0-5, ondalikli) ve degerlendirme sayisi.
type Rating struct {
	Average float64 `json:"average"`
	Count   int32   `json:"count"`
}

// PricingRules, marketin sepet kurallari (ADR-15); pricing bunlari parametre alir.
type PricingRules struct {
	MinBasket             Money `json:"minBasket"`
	DeliveryFee           Money `json:"deliveryFee"`
	FreeDeliveryThreshold Money `json:"freeDeliveryThreshold"`
}

// Market, REST sozlesmesindeki market (@getir/contracts marketSchema).
type Market struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Brand string `json:"brand"`
	// Istege bagli ve MUTLAK URL: bos ise alan hic yazilmaz (Category ile ayni gerekce).
	LogoURL              string       `json:"logoUrl,omitempty"`
	Location             GeoPoint     `json:"location"`
	DeliveryRadiusMeters int32        `json:"deliveryRadiusMeters"`
	IsOpen               bool         `json:"isOpen"`
	DeliveryTime         DeliveryTime `json:"deliveryTime"`
	Rating               Rating       `json:"rating"`
	PricingRules         PricingRules `json:"pricingRules"`
}

// NearbyMarket, liste satiri: market + kullaniciya uzaklik.
type NearbyMarket struct {
	Market         Market `json:"market"`
	DistanceMeters int32  `json:"distanceMeters"`
}

// NearbyMarketList, GET /v1/markets cevabinin data alani (nearbyMarketListSchema).
type NearbyMarketList struct {
	Items []NearbyMarket `json:"items"`
}

func toNearbyMarketList(markets []*catalogv1.NearbyMarket, images ImageResolver) NearbyMarketList {
	// Bos liste JSON'da [] olmali, null DEGIL (bkz. toCategoryList).
	items := make([]NearbyMarket, 0, len(markets))
	for _, nearby := range markets {
		items = append(items, NearbyMarket{
			Market:         toMarket(nearby.GetMarket(), images),
			DistanceMeters: nearby.GetDistanceMeters(),
		})
	}
	return NearbyMarketList{Items: items}
}

func toMarket(market *catalogv1.Market, images ImageResolver) Market {
	return Market{
		ID:                   market.GetId(),
		Name:                 market.GetName(),
		Brand:                market.GetBrand(),
		LogoURL:              images.Resolve(market.GetLogoUrl()),
		Location:             GeoPoint{Lat: market.GetLocation().GetLat(), Lng: market.GetLocation().GetLng()},
		DeliveryRadiusMeters: market.GetDeliveryRadiusMeters(),
		IsOpen:               market.GetIsOpen(),
		DeliveryTime: DeliveryTime{
			MinMinutes: market.GetDeliveryTime().GetMinMinutes(),
			MaxMinutes: market.GetDeliveryTime().GetMaxMinutes(),
		},
		Rating: Rating{
			Average: float64(market.GetRating().GetAverageTenths()) / ratingScale,
			Count:   market.GetRating().GetCount(),
		},
		PricingRules: PricingRules{
			MinBasket:             toMoney(market.GetPricingRules().GetMinBasket()),
			DeliveryFee:           toMoney(market.GetPricingRules().GetDeliveryFee()),
			FreeDeliveryThreshold: toMoney(market.GetPricingRules().GetFreeDeliveryThreshold()),
		},
	}
}

func toMoney(money *commonv1.Money) Money {
	currency := money.GetCurrency()
	if currency == "" {
		currency = defaultCurrency
	}
	return Money{AmountMinor: money.GetAmountMinor(), Currency: currency}
}
