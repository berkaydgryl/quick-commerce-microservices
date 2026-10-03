package catalog

import (
	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

// ratingScale, proto puani onda bir birimle tam sayi tasir (47 = 4.7).
// Float'u telde tasimamak yuvarlama farkini onler; ondaliga cevrim tek yerde.
const ratingScale = 10.0

// storeTypeNames, proto dukkan turu -> sozlesmedeki metin (@getir/contracts
// storeTypeSchema; T11.11). UNSPECIFIED bilerek yok: tur bilinmiyorsa (eski
// catalog-service ya da gateway'in tanimadigi yeni tur) alan hic yazilmaz.
var storeTypeNames = map[catalogv1.StoreType]string{
	catalogv1.StoreType_STORE_TYPE_MARKET:    "MARKET",
	catalogv1.StoreType_STORE_TYPE_MANAV:     "MANAV",
	catalogv1.StoreType_STORE_TYPE_KASAP:     "KASAP",
	catalogv1.StoreType_STORE_TYPE_SARKUTERI: "SARKUTERI",
	catalogv1.StoreType_STORE_TYPE_KURUYEMIS: "KURUYEMIS",
	catalogv1.StoreType_STORE_TYPE_FIRIN:     "FIRIN",
	catalogv1.StoreType_STORE_TYPE_PETSHOP:   "PETSHOP",
	catalogv1.StoreType_STORE_TYPE_CICEKCI:   "CICEKCI",
}

// Money ve GeoPoint, REST'in ortak ilkel tipleridir (internal/rest); order
// adaptoru de ayni bicimi uretir (T7.5'te tasindi, adlar burada korunur).
type (
	Money    = rest.Money
	GeoPoint = rest.GeoPoint
)

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
	LogoURL string `json:"logoUrl,omitempty"`
	// Dukkan turu (T11.11); bilinmiyorsa alan yok (storeTypeNames).
	StoreType string `json:"storeType,omitempty"`
	// Kapak gorseli, MUTLAK URL (T11.11); logo ile ayni kural.
	CoverURL             string       `json:"coverUrl,omitempty"`
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
		items = append(items, toNearbyMarket(nearby, images))
	}
	return NearbyMarketList{Items: items}
}

// toNearbyMarket, liste satiri; genel arama sonucu da ayni satirla baslar.
func toNearbyMarket(nearby *catalogv1.NearbyMarket, images ImageResolver) NearbyMarket {
	return NearbyMarket{
		Market:         toMarket(nearby.GetMarket(), images),
		DistanceMeters: nearby.GetDistanceMeters(),
	}
}

func toMarket(market *catalogv1.Market, images ImageResolver) Market {
	return Market{
		ID:                   market.GetId(),
		Name:                 market.GetName(),
		Brand:                market.GetBrand(),
		LogoURL:              images.Resolve(market.GetLogoUrl()),
		StoreType:            storeTypeNames[market.GetStoreType()],
		CoverURL:             images.Resolve(market.GetCoverUrl()),
		Location:             rest.GeoPointFromProto(market.GetLocation()),
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
			MinBasket:             rest.MoneyFromProto(market.GetPricingRules().GetMinBasket()),
			DeliveryFee:           rest.MoneyFromProto(market.GetPricingRules().GetDeliveryFee()),
			FreeDeliveryThreshold: rest.MoneyFromProto(market.GetPricingRules().GetFreeDeliveryThreshold()),
		},
	}
}
