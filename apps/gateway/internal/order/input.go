package order

import "github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"

// Adaptorun girdileri: HTTP katmani bunlari istek govdesinden, yol
// parametresinden, kimlikten ve basliklardan doldurur. JSON etiketi yoktur;
// JSON bicimi HTTP katmaninin isidir.

// CartItem, rezervasyondaki tek kalem. Fiyat ve sku TASINMAZ: tutar sunucuda
// hesaplanir, sku catalog'dan okunur.
type CartItem struct {
	ProductID string
	Quantity  int32
}

// ReserveInput, POST /v1/cart/reserve.
type ReserveInput struct {
	UserID      string
	MarketID    string
	Items       []CartItem
	AddressLine string
	// Location nil ise istemci konum gondermedi; servis "zorunlu" der.
	Location *rest.GeoPoint
	// ExpectedTotal nil ise istemci toplam gondermedi; servis "zorunlu" der.
	ExpectedTotal  *rest.Money
	CouponCode     string
	IdempotencyKey string
}

// PlaceInput, POST /v1/orders.
type PlaceInput struct {
	UserID         string
	OrderID        string
	CardToken      string
	IdempotencyKey string
	// ClientIP, istegin geldigi IP: gateway TCP baglantisindan okur, istemcinin
	// yazabildigi bir basliktan degil (B9).
	ClientIP string
}

// ConfirmInput, POST /v1/orders/{id}/3ds.
type ConfirmInput struct {
	UserID         string
	OrderID        string
	ChallengeID    string
	Code           string
	IdempotencyKey string
}
