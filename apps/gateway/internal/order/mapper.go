package order

import (
	"fmt"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

// REST sozlesmesindeki cevaplar (@getir/contracts cart.ts ve order.ts). Alan
// adlari proto'nun camelCase karsiligidir; gateway'in yaptigi donusumler
// durumun adi (ORDER_STATUS_PAID -> PAID), zamanin metni ve kalem adedidir.

// Reservation, POST /v1/cart/reserve cevabi (reservationSchema).
type Reservation struct {
	OrderID string `json:"orderId"`
	Status  string `json:"status"`
	// Stok rezervasyonu (T11.2) gelene kadar bos; bos ise alan HIC yazilmaz.
	ExpiresAt string `json:"expiresAt,omitempty"`
}

// ThreeDSChallenge, 3DS bekleyen siparisin dogrulama jetonu.
type ThreeDSChallenge struct {
	ChallengeID string `json:"challengeId"`
}

// Placement, POST /v1/orders ve POST /v1/orders/{id}/3ds cevabi
// (orderPlacementSchema). ThreeDS yalnizca dogrulama bekleniyorsa vardir.
type Placement struct {
	OrderID string            `json:"orderId"`
	Status  string            `json:"status"`
	ThreeDS *ThreeDSChallenge `json:"threeDs,omitempty"`
}

// Line, fiyati dondurulmus kalem (reservationLineSchema).
type Line struct {
	ProductID string     `json:"productId"`
	Name      string     `json:"name"`
	Quantity  int32      `json:"quantity"`
	UnitPrice rest.Money `json:"unitPrice"`
	LineTotal rest.Money `json:"lineTotal"`
}

// Address, teslimat adresi (deliveryAddressSchema): gosterim metni ve konum.
type Address struct {
	Line     string        `json:"line"`
	Location rest.GeoPoint `json:"location"`
}

// TimelineEntry, durum gecmisinin tek kaydi (orderTimelineEntrySchema).
type TimelineEntry struct {
	Status string `json:"status"`
	At     string `json:"at"`
	Note   string `json:"note,omitempty"`
}

// Order, GET /v1/orders/{id} cevabi (orderSchema).
type Order struct {
	ID          string          `json:"id"`
	Status      string          `json:"status"`
	MarketID    string          `json:"marketId"`
	Lines       []Line          `json:"lines"`
	Subtotal    rest.Money      `json:"subtotal"`
	DeliveryFee rest.Money      `json:"deliveryFee"`
	Discount    rest.Money      `json:"discount"`
	Total       rest.Money      `json:"total"`
	Address     Address         `json:"address"`
	Timeline    []TimelineEntry `json:"timeline"`
	CreatedAt   string          `json:"createdAt"`
	UpdatedAt   string          `json:"updatedAt,omitempty"`
}

// statusNames, proto durumu -> sozlesmedeki ad (@getir/core ORDER_STATUS).
// Esleme ELLE ve TAM: yeni durum proto'ya eklenip buraya eklenmezse cevap
// INTERNAL olur ve test kirilir; "ORDER_STATUS_" onekini kesmek, UNSPECIFIED
// gibi anlamsiz bir degeri de istemciye tasirdi.
var statusNames = map[orderv1.OrderStatus]string{
	orderv1.OrderStatus_ORDER_STATUS_DRAFT:            "DRAFT",
	orderv1.OrderStatus_ORDER_STATUS_RISK_CHECK:       "RISK_CHECK",
	orderv1.OrderStatus_ORDER_STATUS_REVIEW:           "REVIEW",
	orderv1.OrderStatus_ORDER_STATUS_REJECTED:         "REJECTED",
	orderv1.OrderStatus_ORDER_STATUS_RESERVED:         "RESERVED",
	orderv1.OrderStatus_ORDER_STATUS_EXPIRED:          "EXPIRED",
	orderv1.OrderStatus_ORDER_STATUS_AWAITING_PAYMENT: "AWAITING_PAYMENT",
	orderv1.OrderStatus_ORDER_STATUS_PAYMENT_FAILED:   "PAYMENT_FAILED",
	orderv1.OrderStatus_ORDER_STATUS_PAID:             "PAID",
	orderv1.OrderStatus_ORDER_STATUS_CANCELLED:        "CANCELLED",
	orderv1.OrderStatus_ORDER_STATUS_PREPARING:        "PREPARING",
	orderv1.OrderStatus_ORDER_STATUS_ON_THE_WAY:       "ON_THE_WAY",
	orderv1.OrderStatus_ORDER_STATUS_DELIVERED:        "DELIVERED",
}

// statusName, durumun sozlesmedeki adi. Bilinmeyen durum servisin sozlesmeyi
// bozdugu demektir: istemciye uydurma deger gitmez, INTERNAL doner.
func statusName(status orderv1.OrderStatus) (string, error) {
	if name, ok := statusNames[status]; ok {
		return name, nil
	}
	return "", &apperror.Error{Code: apperror.CodeInternal, Cause: fmt.Errorf("order: bilinmeyen siparis durumu %v", status)}
}

// timeText, zamani sozlesmedeki metne cevirir (isoDateTimeSchema, UTC).
// Gonderilmeyen zaman bos metindir; alan "omitempty" ile hic yazilmaz.
func timeText(ts *timestamppb.Timestamp) string {
	if ts == nil {
		return ""
	}
	return ts.AsTime().UTC().Format(time.RFC3339Nano)
}

func toReservation(response *orderv1.CreateDraftOrderResponse) (Reservation, error) {
	status, err := statusName(response.GetStatus())
	if err != nil {
		return Reservation{}, err
	}
	return Reservation{
		OrderID:   response.GetOrderId(),
		Status:    status,
		ExpiresAt: timeText(response.GetReservationExpiresAt()),
	}, nil
}

// toPlacement, siparis ve 3DS cevabini kurar. Sozlesme: challengeId bos
// DEGILSE 3DS bekleniyor demektir; bos ise threeDs alani hic yazilmaz.
func toPlacement(orderID string, status orderv1.OrderStatus, challengeID string) (Placement, error) {
	name, err := statusName(status)
	if err != nil {
		return Placement{}, err
	}
	placement := Placement{OrderID: orderID, Status: name}
	if challengeID != "" {
		placement.ThreeDS = &ThreeDSChallenge{ChallengeID: challengeID}
	}
	return placement, nil
}

func toOrder(order *orderv1.Order) (Order, error) {
	// Basarili cevapta siparis bos gelirse servis sozlesmeyi bozmustur; bos bir
	// siparis ("id": "") istemciye gecerli veri gibi gitmemeli.
	if order == nil {
		return Order{}, &apperror.Error{Code: apperror.CodeInternal, Cause: fmt.Errorf("order: GetOrder bos siparis dondu")}
	}
	status, err := statusName(order.GetStatus())
	if err != nil {
		return Order{}, err
	}
	timeline, err := toTimeline(order.GetTimeline())
	if err != nil {
		return Order{}, err
	}
	return Order{
		ID:          order.GetId(),
		Status:      status,
		MarketID:    order.GetMarketId(),
		Lines:       toLines(order.GetItems()),
		Subtotal:    rest.MoneyFromProto(order.GetSubtotal()),
		DeliveryFee: rest.MoneyFromProto(order.GetDeliveryFee()),
		Discount:    rest.MoneyFromProto(order.GetDiscount()),
		Total:       rest.MoneyFromProto(order.GetTotal()),
		Address: Address{
			Line:     order.GetDeliveryAddress(),
			Location: rest.GeoPointFromProto(order.GetDeliveryLocation()),
		},
		Timeline:  timeline,
		CreatedAt: timeText(order.GetCreatedAt()),
		UpdatedAt: timeText(order.GetUpdatedAt()),
	}, nil
}

func toLines(items []*orderv1.OrderItem) []Line {
	// Bos liste JSON'da [] olmali, null DEGIL: sozlesme lines'i dizi olarak zorunlu tutar.
	lines := make([]Line, 0, len(items))
	for _, item := range items {
		lines = append(lines, Line{
			ProductID: item.GetProductId(),
			Name:      item.GetName(),
			Quantity:  item.GetQuantity().GetValue(),
			UnitPrice: rest.MoneyFromProto(item.GetUnitPrice()),
			LineTotal: rest.MoneyFromProto(item.GetLineTotal()),
		})
	}
	return lines
}

func toTimeline(entries []*orderv1.OrderTimelineEntry) ([]TimelineEntry, error) {
	timeline := make([]TimelineEntry, 0, len(entries))
	for _, entry := range entries {
		status, err := statusName(entry.GetStatus())
		if err != nil {
			return nil, err
		}
		timeline = append(timeline, TimelineEntry{Status: status, At: timeText(entry.GetAt()), Note: entry.GetNote()})
	}
	return timeline, nil
}
