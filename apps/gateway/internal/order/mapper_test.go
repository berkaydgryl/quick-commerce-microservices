package order

import (
	"context"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"
	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

func TestGetMapsFullOrder(t *testing.T) {
	createdAt := time.Date(2026, 9, 28, 11, 7, 7, 0, time.UTC)
	stub := &stubServer{order: &orderv1.Order{
		Id:       orderID,
		UserId:   "usr_1",
		MarketId: "mkt_migros-jet-moda",
		Status:   orderv1.OrderStatus_ORDER_STATUS_PAID,
		Items: []*orderv1.OrderItem{{
			ProductId: "prd_cikolata-80",
			Sku:       "CIKOLATA-80",
			Name:      "Cikolata",
			Quantity:  &commonv1.Quantity{Value: 2, Unit: commonv1.Unit_UNIT_PIECE},
			UnitPrice: &commonv1.Money{AmountMinor: 3_290, Currency: "TRY"},
			LineTotal: &commonv1.Money{AmountMinor: 6_580},
		}},
		Subtotal:         &commonv1.Money{AmountMinor: 6_580, Currency: "TRY"},
		DeliveryFee:      &commonv1.Money{AmountMinor: 2_490, Currency: "TRY"},
		Discount:         &commonv1.Money{AmountMinor: 0, Currency: "TRY"},
		Total:            &commonv1.Money{AmountMinor: 9_070, Currency: "TRY"},
		DeliveryLocation: &commonv1.GeoPoint{Lat: 40.99, Lng: 29.02},
		DeliveryAddress:  "Kadikoy",
		CreatedAt:        timestamppb.New(createdAt),
		UpdatedAt:        timestamppb.New(createdAt.Add(9 * time.Second)),
		Timeline: []*orderv1.OrderTimelineEntry{
			{Status: orderv1.OrderStatus_ORDER_STATUS_DRAFT, At: timestamppb.New(createdAt)},
			{Status: orderv1.OrderStatus_ORDER_STATUS_RESERVED, At: timestamppb.New(createdAt), Note: "PENDING_RESERVATION"},
		},
	}}
	service := startStub(t, stub)

	found, err := service.Get(context.Background(), "usr_1", orderID)
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	if stub.getRequest.GetUserId() != "usr_1" || stub.getRequest.GetOrderId() != orderID {
		t.Errorf("sahiplik icin kullanici tasinmali: %v", stub.getRequest)
	}
	want := `{"id":"` + orderID + `","status":"PAID","marketId":"mkt_migros-jet-moda",` +
		`"lines":[{"productId":"prd_cikolata-80","name":"Cikolata","quantity":2,"unitPrice":{"amountMinor":3290,"currency":"TRY"},"lineTotal":{"amountMinor":6580,"currency":"TRY"}}],` +
		`"subtotal":{"amountMinor":6580,"currency":"TRY"},"deliveryFee":{"amountMinor":2490,"currency":"TRY"},` +
		`"discount":{"amountMinor":0,"currency":"TRY"},"total":{"amountMinor":9070,"currency":"TRY"},` +
		`"address":{"line":"Kadikoy","location":{"lat":40.99,"lng":29.02}},` +
		`"timeline":[{"status":"DRAFT","at":"2026-09-28T11:07:07Z"},{"status":"RESERVED","at":"2026-09-28T11:07:07Z","note":"PENDING_RESERVATION"}],` +
		`"createdAt":"2026-09-28T11:07:07Z","updatedAt":"2026-09-28T11:07:16Z"}`
	if got := testkit.JSON(t, found); got != want {
		t.Errorf("siparis:\n got %s\nwant %s", got, want)
	}
}

func TestUnknownStatusIsInternal(t *testing.T) {
	// Servis sozlesmeyi bozarsa (UNSPECIFIED) istemciye uydurma durum gitmemeli.
	stub := &stubServer{placeResponse: &orderv1.CreateOrderResponse{OrderId: orderID}}
	service := startStub(t, stub)

	_, err := service.Place(context.Background(), PlaceInput{Method: MethodCard, UserID: "usr_1", OrderID: orderID, CardToken: "tok", IdempotencyKey: "anahtar-0002"})

	if code := testkit.AppErrorOf(t, err).Code; code != apperror.CodeInternal {
		t.Errorf("INTERNAL bekleniyordu, %s geldi", code)
	}
}

func TestStatusNamesCoverEveryProtoStatus(t *testing.T) {
	// Proto'ya durum eklenip esleme unutulursa bu test kirilir.
	for value, protoName := range orderv1.OrderStatus_name {
		status := orderv1.OrderStatus(value)
		if status == orderv1.OrderStatus_ORDER_STATUS_UNSPECIFIED {
			continue
		}
		if _, err := statusName(status); err != nil {
			t.Errorf("%s icin sozlesme adi yok", protoName)
		}
	}
}
