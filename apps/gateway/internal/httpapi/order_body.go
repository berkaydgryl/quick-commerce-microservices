package httpapi

import (
	"math"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

// Siparis uclarinin istek govdeleri (@getir/contracts cart.ts ve order.ts).
//
// Yalnizca BICIM burada dogrulanir; kurallar (sepet bos olamaz, adet 1-99,
// enlem -90..90, kupon uzunlugu) order-service'tedir ve hatasi REST alan
// adlariyla geri gelir. Burada tek yapilan, servisin GOREMEYECEGI bir yoklugu
// yakalamaktir: ic ice nesneler isaretcidir ki "gonderilmedi" ile "0" ayrilsin.
// Konum gonderilmediyse proto'ya da gonderilmez ve servis "zorunlu" der;
// gonderilen konumun enlemi eksikse (0 degil, YOK) bunu yalniz gateway gorur.

// reserveBody, POST /v1/cart/reserve (reserveCartRequestSchema).
type reserveBody struct {
	MarketID      string         `json:"marketId"`
	Items         []cartItemBody `json:"items"`
	Address       *addressBody   `json:"address"`
	ExpectedTotal *moneyBody     `json:"expectedTotal"`
	CouponCode    string         `json:"couponCode"`
}

type cartItemBody struct {
	ProductID string `json:"productId"`
	Quantity  int32  `json:"quantity"`
}

type addressBody struct {
	Line     string        `json:"line"`
	Location *geoPointBody `json:"location"`
}

type geoPointBody struct {
	Lat *float64 `json:"lat"`
	Lng *float64 `json:"lng"`
}

type moneyBody struct {
	AmountMinor *int64 `json:"amountMinor"`
	Currency    string `json:"currency"`
}

// placeBody, POST /v1/orders (createOrderRequestSchema).
type placeBody struct {
	OrderID string       `json:"orderId"`
	Payment *paymentBody `json:"payment"`
	// Details, hediye, not, "Zili Çalma", onay (T12.4): order_details_body.go.
	Details *detailsBody `json:"details"`
}

// paymentBody: alanlar isaretcidir (T12.4): sozlesmede GONDERILEN alan
// sayilir; bos metin "gonderilmedi" degildir. Kurallar order.PaymentChoice'ta.
type paymentBody struct {
	// Method, CARD ya da CASH_ON_DELIVERY.
	Method string `json:"method"`
	// CardID, kasadaki kayitli kart; CardToken DEPRECATED test jetonu (kartta).
	CardID    sentText `json:"cardId"`
	CardToken sentText `json:"cardToken"`
	// OnDelivery, kapida odemenin turu: CASH ya da POS (kapida odemede).
	OnDelivery sentText `json:"onDelivery"`
}

// threeDSBody, POST /v1/orders/{id}/3ds (threeDsRequestSchema).
type threeDSBody struct {
	ChallengeID string `json:"challengeId"`
	OTP         string `json:"otp"`
}

// toInput, rezervasyon govdesini adaptor girdisine cevirir; bicim sorunlarini errs'e yazar.
func (b reserveBody) toInput(userID, idempotencyKey string, errs fieldErrors) order.ReserveInput {
	items := make([]order.CartItem, 0, len(b.Items))
	for _, item := range b.Items {
		items = append(items, order.CartItem{ProductID: item.ProductID, Quantity: item.Quantity})
	}
	input := order.ReserveInput{
		UserID:         userID,
		MarketID:       b.MarketID,
		Items:          items,
		CouponCode:     b.CouponCode,
		IdempotencyKey: idempotencyKey,
	}
	if b.Address != nil {
		input.AddressLine = b.Address.Line
		input.Location = b.Address.Location.toPoint("address.location", errs)
	}
	if b.ExpectedTotal != nil {
		input.ExpectedTotal = b.ExpectedTotal.toMoney("expectedTotal", errs)
	}
	return input
}

// toPoint, gonderilen konumu cevirir; gonderilmediyse nil (servis "zorunlu" der).
func (p *geoPointBody) toPoint(field string, errs fieldErrors) *rest.GeoPoint {
	if p == nil {
		return nil
	}
	if p.Lat == nil {
		errs[field+".lat"] = requiredReason
	}
	if p.Lng == nil {
		errs[field+".lng"] = requiredReason
	}
	if p.Lat == nil || p.Lng == nil {
		return nil
	}
	return &rest.GeoPoint{Lat: *p.Lat, Lng: *p.Lng}
}

// toMoney, gonderilen tutari cevirir. Tutar YOKSA bunu yalniz gateway gorur:
// proto'da 0 olarak gider ve 0 TL gercek bir toplam gibi karsilastirilirdi.
func (m *moneyBody) toMoney(field string, errs fieldErrors) *rest.Money {
	if m.AmountMinor == nil {
		errs[field+".amountMinor"] = requiredReason
		return nil
	}
	return &rest.Money{AmountMinor: *m.AmountMinor, Currency: m.Currency}
}

// toInput, siparis govdesini adaptor girdisine cevirir. Yontem kart ya da
// kapida odeme (T12.4); kurallar order.PaymentChoice'ta. Risk sinyalleri
// govdeden GELMEZ (B9); handler onlari oturumdan ekler.
func (b placeBody) toInput(userID, idempotencyKey string, errs fieldErrors) order.PlaceInput {
	input := order.PlaceInput{
		UserID:         userID,
		OrderID:        b.OrderID,
		IdempotencyKey: idempotencyKey,
	}
	if b.Payment == nil {
		errs[paymentField] = requiredReason
	} else {
		payment := order.PaymentChoice{
			Method:     b.Payment.Method,
			CardID:     b.Payment.CardID.value(),
			CardToken:  b.Payment.CardToken.value(),
			OnDelivery: b.Payment.OnDelivery.value(),
		}.Normalized()
		collectUnder(errs, paymentField, payment.Problems())
		payment.Apply(&input)
	}
	input.Details = b.Details.toDetails(errs)
	return input
}

// toInput, 3DS govdesini adaptor girdisine cevirir; kod bicimi servistedir.
func (b threeDSBody) toInput(userID, orderID, idempotencyKey string) order.ConfirmInput {
	return order.ConfirmInput{
		UserID:         userID,
		OrderID:        orderID,
		ChallengeID:    b.ChallengeID,
		Code:           b.OTP,
		IdempotencyKey: idempotencyKey,
	}
}

// toOrderSignals, kimlik servisinin sinyallerini siparis adaptorunun girdisine
// cevirir. Iki paket birbirini bilmez; ceviri HTTP katmanindadir.
func toOrderSignals(signals auth.CheckoutSignals) order.Signals {
	out := order.Signals{
		IPAddress:         signals.IPAddress,
		IPCity:            signals.IPCity,
		DeviceID:          signals.DeviceID,
		AccountsOnDevice:  clampInt32(signals.AccountsOnDevice),
		PreviousIPAddress: signals.PreviousIPAddress,
		AccountCreatedAt:  signals.AccountCreatedAt,
	}
	if signals.SessionLocation != nil {
		out.SessionLocation = &rest.GeoPoint{Lat: signals.SessionLocation.Lat, Lng: signals.SessionLocation.Lng}
	}
	return out
}

// clampInt32, sayiyi proto int32 sinirina oturtur (cihaz basina hesap sayisi
// pratikte kucuktur; sinir yalnizca tasmayi onler).
func clampInt32(value int) int32 {
	if value > math.MaxInt32 {
		return math.MaxInt32
	}
	return int32(value)
}
