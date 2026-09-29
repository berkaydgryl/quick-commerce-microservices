package order

import (
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

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
	// Signals, gateway'in bildigi risk sinyalleri (B9: istemciden alinmaz).
	Signals Signals
}

// Signals, siparisin risk sinyalleri (proto order.v1.CheckoutSignals). IP
// baglantidan, digerleri oturum ve kullanici kaydindan gelir (T8.1). Bos alan
// "bilinmiyor" demektir ve ilgili risk kuralini tetiklemez.
type Signals struct {
	IPAddress         string
	IPCity            string
	DeviceID          string
	AccountsOnDevice  int32
	PreviousIPAddress string
	// SessionLocation nil ise oturumun konumu bilinmiyor.
	SessionLocation *rest.GeoPoint
	// AccountCreatedAt sifirsa hesap yasi bilinmiyor.
	AccountCreatedAt time.Time
}

// ConfirmInput, POST /v1/orders/{id}/3ds.
type ConfirmInput struct {
	UserID         string
	OrderID        string
	ChallengeID    string
	Code           string
	IdempotencyKey string
}
