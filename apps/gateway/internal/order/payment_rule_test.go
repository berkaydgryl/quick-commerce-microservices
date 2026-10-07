package order

import (
	"context"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"
	paymentv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/payment/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Kapida odeme (T12.4): tur zorunlu, kart alani yok; tele giden istek; cevaptaki
// secim; CONFLICT'te degisen alanin REST adi.

func TestCashOnDeliveryChoiceRules(t *testing.T) {
	text := func(value string) *string { return &value }
	for _, tc := range []struct {
		name   string
		choice PaymentChoice
		want   map[string]string
	}{
		{"nakit", PaymentChoice{Method: MethodCashOnDelivery, OnDelivery: text(KindCash)}, map[string]string{}},
		{"POS", PaymentChoice{Method: MethodCashOnDelivery, OnDelivery: text(KindPOS)}, map[string]string{}},
		{"tur yok", PaymentChoice{Method: MethodCashOnDelivery}, map[string]string{fieldOnDelivery: onDeliveryReason}},
		{"bilinmeyen tur (CARD)", PaymentChoice{Method: MethodCashOnDelivery, OnDelivery: text("CARD")}, map[string]string{fieldOnDelivery: onDeliveryReason}},
		{"kart kimligi gonderildi", PaymentChoice{Method: MethodCashOnDelivery, OnDelivery: text(KindCash), CardID: text(testCardID)},
			map[string]string{fieldCardID: notAllowedReason}},
		{"jeton gonderildi (bos bile)", PaymentChoice{Method: MethodCashOnDelivery, OnDelivery: text(KindCash), CardToken: text("")},
			map[string]string{fieldCardToken: notAllowedReason}},
		{"kartta tur", PaymentChoice{Method: MethodCard, CardID: text(testCardID), OnDelivery: text(KindCash)},
			map[string]string{fieldOnDelivery: notAllowedReason}},
		{"bilinmeyen yontem", PaymentChoice{Method: "CHEQUE"}, map[string]string{fieldMethod: methodReason}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.choice.Normalized().Problems(); testkit.JSON(t, got) != testkit.JSON(t, tc.want) {
				t.Errorf("sonuc %v, beklenen %v", got, tc.want)
			}
		})
	}
}

func TestPlaceSendsCashOnDeliveryKindAndNoCard(t *testing.T) {
	stub := &stubServer{placeResponse: &orderv1.CreateOrderResponse{OrderId: orderID, Status: orderv1.OrderStatus_ORDER_STATUS_PAID}}
	service := startStub(t, stub)

	for kind, want := range map[string]orderv1.DeliveryPaymentKind{
		KindCash: orderv1.DeliveryPaymentKind_DELIVERY_PAYMENT_KIND_CASH,
		KindPOS:  orderv1.DeliveryPaymentKind_DELIVERY_PAYMENT_KIND_POS,
	} {
		if _, err := service.Place(context.Background(), PlaceInput{
			UserID: "usr_1", OrderID: orderID, Method: MethodCashOnDelivery, OnDelivery: kind, IdempotencyKey: "anahtar-0002",
		}); err != nil {
			t.Fatalf("hata beklenmiyordu: %v", err)
		}
		sent := stub.placeRequest
		if sent.GetPaymentMethod() != paymentv1.PaymentMethod_PAYMENT_METHOD_CASH_ON_DELIVERY || sent.GetOnDelivery() != want ||
			sent.GetCardId() != "" || sent.GetCardToken() != "" {
			t.Errorf("%s: kapida odeme ve tur tasinmali, kart bos: %v", kind, sent)
		}
	}
}

func TestPlaceCardSendsNoKind(t *testing.T) {
	stub := &stubServer{placeResponse: &orderv1.CreateOrderResponse{OrderId: orderID, Status: orderv1.OrderStatus_ORDER_STATUS_PAID}}
	service := startStub(t, stub)

	if _, err := service.Place(context.Background(), PlaceInput{UserID: "usr_1", OrderID: orderID, Method: MethodCard, CardID: testCardID, IdempotencyKey: "anahtar-0002"}); err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if sent := stub.placeRequest; sent.GetPaymentMethod() != paymentv1.PaymentMethod_PAYMENT_METHOD_CARD ||
		sent.GetOnDelivery() != orderv1.DeliveryPaymentKind_DELIVERY_PAYMENT_KIND_UNSPECIFIED {
		t.Errorf("kartta yontem CARD, tur bos olmali: %v", sent)
	}
}

func TestConflictFieldIsRenamedToRESTPath(t *testing.T) {
	// order'in "odeme bekleyen sipariste secim degisti" CONFLICT'i proto adini tasir.
	for proto, rest := range map[string]string{"paymentMethod": "payment.method", "onDelivery": "payment.onDelivery"} {
		stub := &stubServer{
			err:     status.Error(codes.Aborted, "secim degisti"),
			trailer: metadata.Pairs(apperror.MetadataKey, `{"code":"CONFLICT","message":"x","details":{"orderId":"`+orderID+`","field":"`+proto+`"}}`),
		}
		service := startStub(t, stub)

		_, err := service.Place(context.Background(), PlaceInput{UserID: "usr_1", OrderID: orderID, Method: MethodCard, CardID: testCardID, IdempotencyKey: "anahtar-0002"})

		appErr := testkit.AppErrorOf(t, err)
		if appErr.Code != apperror.CodeConflict || appErr.Details["field"] != rest || appErr.Details["orderId"] != orderID {
			t.Errorf("%s: CONFLICT + field %q bekleniyordu: %s %v", proto, rest, appErr.Code, appErr.Details)
		}
	}
}

func TestPaymentViewMapsEveryKnownValueAndOmitsUnknown(t *testing.T) {
	for value, name := range paymentv1.PaymentMethod_name {
		method := paymentv1.PaymentMethod(value)
		view := toPaymentView(&orderv1.OrderPayment{Method: method})
		if method == paymentv1.PaymentMethod_PAYMENT_METHOD_UNSPECIFIED {
			if view != nil {
				t.Errorf("UNSPECIFIED yontem yazilmamali: %+v", view)
			}
			continue
		}
		if view == nil {
			t.Errorf("%s icin REST adi yok", name)
		}
	}
	for value, name := range orderv1.DeliveryPaymentKind_name {
		kind := orderv1.DeliveryPaymentKind(value)
		view := toPaymentView(&orderv1.OrderPayment{Method: paymentv1.PaymentMethod_PAYMENT_METHOD_CASH_ON_DELIVERY, OnDelivery: kind})
		if (kind == orderv1.DeliveryPaymentKind_DELIVERY_PAYMENT_KIND_UNSPECIFIED) != (view.OnDelivery == "") {
			t.Errorf("%s: tur eslemesi eksik ya da UNSPECIFIED yazildi: %+v", name, view)
		}
	}
	if toPaymentView(nil) != nil {
		t.Error("secimsiz (eski) sipariste payment yok")
	}
}

func TestGetAndAdapterPageCarryPaymentChoice(t *testing.T) {
	// Adaptorun Page'i tasir; REST gecmis ozeti (orderhistory) bu alani tanimlamaz.
	order := detailedOrder()
	order.Payment = &orderv1.OrderPayment{
		Method:     paymentv1.PaymentMethod_PAYMENT_METHOD_CASH_ON_DELIVERY,
		OnDelivery: orderv1.DeliveryPaymentKind_DELIVERY_PAYMENT_KIND_POS,
	}
	stub := &stubServer{order: order, listResponse: &orderv1.ListMyOrdersResponse{Orders: []*orderv1.Order{order}}}
	service := startStub(t, stub)

	found, err := service.GetDetailed(context.Background(), "usr_1", orderID)
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	page, err := service.Page(context.Background(), "usr_1", 20, "")
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	want := `{"method":"CASH_ON_DELIVERY","onDelivery":"POS"}`
	if got := testkit.JSON(t, found.Payment); got != want {
		t.Errorf("GET: %s", got)
	}
	if got := testkit.JSON(t, page.Orders[0].Payment); got != want {
		t.Errorf("liste: %s", got)
	}
}

func TestOnDeliveryValidationFieldIsRenamed(t *testing.T) {
	stub := &stubServer{
		err:     status.Error(codes.InvalidArgument, "gecersiz"),
		trailer: metadata.Pairs(apperror.MetadataKey, `{"code":"VALIDATION_FAILED","message":"x","details":{"onDelivery":"kapida odemede tur zorunlu (nakit ya da POS)"}}`),
	}
	service := startStub(t, stub)

	_, err := service.Place(context.Background(), PlaceInput{UserID: "usr_1", OrderID: orderID, Method: MethodCashOnDelivery, OnDelivery: KindCash, IdempotencyKey: "anahtar-0002"})

	if got := testkit.JSON(t, testkit.AppErrorOf(t, err).Details); got != `{"payment.onDelivery":"kapida odemede tur zorunlu (nakit ya da POS)"}` {
		t.Errorf("REST alan adi bekleniyordu: %s", got)
	}
}

func TestConflictRenameDoesNotMutateTheOriginalError(t *testing.T) {
	original := &apperror.Error{Code: apperror.CodeConflict, Details: map[string]any{"field": "onDelivery", "orderId": orderID}}

	renamed := renameConflictField(original, placeFieldNames)

	if original.Details["field"] != "onDelivery" {
		t.Errorf("asil hata degismemeli: %v", original.Details)
	}
	if testkit.AppErrorOf(t, renamed).Details["field"] != "payment.onDelivery" {
		t.Errorf("kopyada REST adi bekleniyordu: %v", renamed)
	}
}
