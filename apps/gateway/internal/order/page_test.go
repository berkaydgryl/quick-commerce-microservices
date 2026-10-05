package order

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"
	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Gecmis Siparislerim'in ham sayfasi (T11.16; ListMyOrders).

func TestPageCarriesUserAndCursorAndMapsOrders(t *testing.T) {
	createdAt := time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC)
	stub := &stubServer{listResponse: &orderv1.ListMyOrdersResponse{
		Orders: []*orderv1.Order{{
			Id: orderID, MarketId: "mkt_migros-jet-moda", Status: orderv1.OrderStatus_ORDER_STATUS_DELIVERED,
			Total:     &commonv1.Money{AmountMinor: 50_000, Currency: "TRY"},
			CreatedAt: timestamppb.New(createdAt),
			Timeline:  []*orderv1.OrderTimelineEntry{{Status: orderv1.OrderStatus_ORDER_STATUS_DELIVERED, At: timestamppb.New(createdAt)}},
		}},
		Page: &commonv1.PageResponse{NextPageToken: "sonraki"},
	}}
	service := startStub(t, stub)

	page, err := service.Page(context.Background(), "usr_1", 20, "imlec")

	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if stub.listRequest.GetUserId() != "usr_1" || stub.listRequest.GetPage().GetPageSize() != 20 || stub.listRequest.GetPage().GetPageToken() != "imlec" {
		t.Errorf("kullanici, sayfa boyu ve imlec tasinmali: %v", stub.listRequest)
	}
	if page.NextPageToken != "sonraki" || len(page.Orders) != 1 || page.Orders[0].Status != "DELIVERED" ||
		page.Orders[0].Total.AmountMinor != 50_000 || page.Orders[0].CreatedAt != "2026-10-05T09:00:00Z" {
		t.Errorf("sayfa eslenmeli: %+v", page)
	}
}

func TestPageRenamesTheCursorField(t *testing.T) {
	stub := &stubServer{
		err:     status.Error(codes.InvalidArgument, "x"),
		trailer: appErrorTrailer(`{"code":"VALIDATION_FAILED","message":"x","details":{"page.pageToken":"gecersiz sayfa jetonu"}}`),
	}
	service := startStub(t, stub)

	_, err := service.Page(context.Background(), "usr_1", 0, "bozuk")

	if details := testkit.AppErrorOf(t, err).Details; details["pageToken"] != "gecersiz sayfa jetonu" {
		t.Errorf("imlec hatasi sorgu parametresinin adiyla gorunmeli: %+v", details)
	}
}

func TestPageWithUnknownStatusIsInternal(t *testing.T) {
	stub := &stubServer{listResponse: &orderv1.ListMyOrdersResponse{Orders: []*orderv1.Order{{Id: orderID}}}}
	service := startStub(t, stub)

	_, err := service.Page(context.Background(), "usr_1", 0, "")

	if code := testkit.AppErrorOf(t, err).Code; code != "INTERNAL" {
		t.Errorf("sozlesmeyi bozan durum INTERNAL olmali: %s", code)
	}
}
