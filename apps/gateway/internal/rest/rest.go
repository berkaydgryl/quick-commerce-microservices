// Package rest, REST sozlesmesinin (@getir/contracts common.ts) birden fazla
// servis adaptorunun urettigi ilkel tipleridir: para ve konum.
//
// NEDEN AYRI PAKET (T7.5): tipler once yalnizca catalog adaptorundeydi; order
// adaptoru de ayni bicimi uretiyor. Kopyasi olsaydi bir gun biri para birimi
// kuralini degistirir, digeri eski bicimle kalirdi.
package rest

import commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"

// DefaultCurrency, proto'da bos para birimi TRY demektir; REST sozlesmesi
// (moneySchema) ise alani acikca "TRY" ister.
const DefaultCurrency = "TRY"

// Money, kurus cinsinden tutar (@getir/contracts moneySchema). Float yok.
type Money struct {
	AmountMinor int64  `json:"amountMinor"`
	Currency    string `json:"currency"`
}

// GeoPoint, WGS84 koordinati (@getir/contracts geoPointSchema).
type GeoPoint struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// MoneyFromProto, proto tutarini REST bicimine cevirir; bos para birimi TRY olur.
func MoneyFromProto(money *commonv1.Money) Money {
	currency := money.GetCurrency()
	if currency == "" {
		currency = DefaultCurrency
	}
	return Money{AmountMinor: money.GetAmountMinor(), Currency: currency}
}

// GeoPointFromProto, proto konumunu REST bicimine cevirir.
func GeoPointFromProto(point *commonv1.GeoPoint) GeoPoint {
	return GeoPoint{Lat: point.GetLat(), Lng: point.GetLng()}
}
