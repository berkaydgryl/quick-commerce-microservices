package order

import (
	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"
	paymentv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/payment/v1"
)

// Odeme seciminin proto <-> REST cevirisi (T12.4). Tek kaynak ileri sozlukler
// (methodToProto, kindToProto); ters sozlukler onlardan kurulur, tur kurali da
// kindToProto'ya bakar. Proto'ya deger eklenip burasi unutulursa cevapta alan
// yazilmaz; payment_rule_test.go her proto degerini dener.

var methodToProto = map[string]paymentv1.PaymentMethod{
	MethodCard:           paymentv1.PaymentMethod_PAYMENT_METHOD_CARD,
	MethodCashOnDelivery: paymentv1.PaymentMethod_PAYMENT_METHOD_CASH_ON_DELIVERY,
}

var kindToProto = map[string]orderv1.DeliveryPaymentKind{
	KindCash: orderv1.DeliveryPaymentKind_DELIVERY_PAYMENT_KIND_CASH,
	KindPOS:  orderv1.DeliveryPaymentKind_DELIVERY_PAYMENT_KIND_POS,
}

var (
	methodNames = inverse(methodToProto)
	kindNames   = inverse(kindToProto)
)

func inverse[V comparable](forward map[string]V) map[V]string {
	names := make(map[V]string, len(forward))
	for name, value := range forward {
		names[value] = name
	}
	return names
}

// PaymentView, siparisin odeme secimi (orderPaymentViewSchema): yontem ve
// kapida odemenin turu. Kisisel veri degil. Tek siparis cevabi (GET) tasir;
// REST gecmis ozeti (orderSummarySchema, orderhistory) bu alani tanimlamaz.
type PaymentView struct {
	Method     string `json:"method"`
	OnDelivery string `json:"onDelivery,omitempty"`
}

// toPaymentView, siparisin secimini cevaba cevirir. Secimsiz (eski) sipariste
// ya da bilinmeyen yontemde nil: uydurma yontem istemciye gitmez.
func toPaymentView(payment *orderv1.OrderPayment) *PaymentView {
	if payment == nil {
		return nil
	}
	method, known := methodNames[payment.GetMethod()]
	if !known {
		return nil
	}
	return &PaymentView{Method: method, OnDelivery: kindNames[payment.GetOnDelivery()]}
}
