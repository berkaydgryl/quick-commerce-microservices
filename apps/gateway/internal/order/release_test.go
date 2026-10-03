package order

import (
	"context"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// T11.4: sepet onayinda ve sipariste geri sayim alanlari, rezervasyonu birakma.

var fixedNow = time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)

// startStubAt, adaptoru sabit saatle kurar (ttlSeconds ve birakma ani).
func startStubAt(t *testing.T, stub *stubServer, now time.Time) *Service {
	t.Helper()
	service := startStub(t, stub)
	service.now = func() time.Time { return now }
	return service
}

func TestReserveReturnsExpiryAndRemainingSeconds(t *testing.T) {
	expiresAt := fixedNow.Add(90*time.Second + 400*time.Millisecond)
	stub := &stubServer{draftResponse: &orderv1.CreateDraftOrderResponse{
		OrderId:              orderID,
		Status:               orderv1.OrderStatus_ORDER_STATUS_DRAFT,
		ReservationExpiresAt: timestamppb.New(expiresAt),
	}}
	service := startStubAt(t, stub, fixedNow)

	reservation, err := service.Reserve(context.Background(), reserveInput())
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	// 90,4 sn kalmis: yukari yuvarlanir (istemci dolmadan sifir gostermez).
	want := `{"orderId":"` + orderID + `","status":"DRAFT","expiresAt":"2026-10-02T12:01:30.4Z","ttlSeconds":91}`
	if got := testkit.JSON(t, reservation); got != want {
		t.Errorf("cevap:\n got %s\nwant %s", got, want)
	}
}

func TestRemainingSecondsIsZeroOnceExpiredAndAbsentWithoutExpiry(t *testing.T) {
	past := remainingSeconds(timestamppb.New(fixedNow.Add(-5*time.Second)), fixedNow)
	exact := remainingSeconds(timestamppb.New(fixedNow), fixedNow)

	if past == nil || *past != 0 || exact == nil || *exact != 0 {
		t.Errorf("dolmus kilit 0 olmali (alan yazilir): %v %v", past, exact)
	}
	if remainingSeconds(nil, fixedNow) != nil {
		t.Error("bitis yoksa alan hic yazilmamali (nil)")
	}
}

func TestGetOrderCarriesReservationCountdownOnlyWhileLocked(t *testing.T) {
	createdAt := fixedNow.Add(-time.Minute)
	locked := &orderv1.Order{
		Id: orderID, Status: orderv1.OrderStatus_ORDER_STATUS_AWAITING_PAYMENT, MarketId: "mkt_migros-jet-moda",
		CreatedAt:            timestamppb.New(createdAt),
		ReservationExpiresAt: timestamppb.New(fixedNow.Add(45 * time.Second)),
	}
	service := startStubAt(t, &stubServer{order: locked}, fixedNow)

	found, err := service.Get(context.Background(), "usr_1", orderID)
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if found.ReservationExpiresAt != "2026-10-02T12:00:45Z" || found.ReservationTTLSeconds == nil || *found.ReservationTTLSeconds != 45 {
		t.Errorf("kilit canliyken bitis ve kalan saniye: %q %v", found.ReservationExpiresAt, found.ReservationTTLSeconds)
	}

	paid := &orderv1.Order{Id: orderID, Status: orderv1.OrderStatus_ORDER_STATUS_PAID, CreatedAt: timestamppb.New(createdAt)}
	settled, err := startStubAt(t, &stubServer{order: paid}, fixedNow).Get(context.Background(), "usr_1", orderID)
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if got := testkit.JSON(t, settled); strings.Contains(got, "reservation") {
		t.Errorf("kilitsiz sipariste geri sayim alani yazilmamali: %s", got)
	}
}

func TestReleaseCancelsOrderAndReportsReleased(t *testing.T) {
	stub := &stubServer{}
	service := startStubAt(t, stub, fixedNow)

	released, err := service.Release(context.Background(), ReleaseInput{UserID: "usr_1", OrderID: orderID, IdempotencyKey: "anahtar-0002"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	sent := stub.cancelRequest
	if sent.GetOrderId() != orderID || sent.GetUserId() != "usr_1" || sent.GetIdempotencyKey() != "anahtar-0002" || sent.GetReason() != "" {
		t.Errorf("siparis, kullanici ve anahtar tasinmali; gerekce BOS (order taslakta CART_RELEASED yazar): %v", sent)
	}
	want := `{"orderId":"` + orderID + `","released":true,"releasedAt":"2026-10-02T12:00:00Z"}`
	if got := testkit.JSON(t, released); got != want {
		t.Errorf("cevap:\n got %s\nwant %s", got, want)
	}
	if stub.getRequest != nil {
		t.Error("basarili birakmada siparis ayrica okunmamali")
	}
}

func appErrorTrailer(payload string) metadata.MD {
	return metadata.Pairs(apperror.MetadataKey, payload)
}

func TestReleaseOfAlreadyCancelledOrderIsNotAnError(t *testing.T) {
	cancelledAt := fixedNow.Add(-3 * time.Minute)
	stub := &stubServer{
		cancelErr:     status.Error(codes.FailedPrecondition, "iptal edilemez"),
		cancelTrailer: appErrorTrailer(`{"code":"ORDER_STATE_INVALID","message":"x","details":{"orderId":"` + orderID + `","status":"CANCELLED"}}`),
		order: &orderv1.Order{
			Id: orderID, Status: orderv1.OrderStatus_ORDER_STATUS_CANCELLED,
			CreatedAt: timestamppb.New(cancelledAt.Add(-time.Minute)), UpdatedAt: timestamppb.New(cancelledAt),
		},
	}
	service := startStubAt(t, stub, fixedNow)

	released, err := service.Release(context.Background(), ReleaseInput{UserID: "usr_1", OrderID: orderID, IdempotencyKey: "anahtar-0003"})
	if err != nil {
		t.Fatalf("zaten iptal hata olmamali: %v", err)
	}

	want := `{"orderId":"` + orderID + `","released":false,"releasedAt":"2026-10-02T11:57:00Z"}`
	if got := testkit.JSON(t, released); got != want {
		t.Errorf("cevap (iptal ani siparisin son guncellenmesi):\n got %s\nwant %s", got, want)
	}
	if stub.getRequest.GetUserId() != "usr_1" {
		t.Errorf("siparis kullanicinin kimligiyle okunmali: %v", stub.getRequest)
	}
}

func TestReleaseOtherFailuresPassThrough(t *testing.T) {
	cases := []struct {
		name    string
		code    codes.Code
		payload string
		want    apperror.Code
	}{
		{"odenmis siparis", codes.FailedPrecondition, `{"code":"ORDER_STATE_INVALID","message":"x","details":{"orderId":"o","status":"PAID"}}`, apperror.CodeOrderStateInvalid},
		{"parasi alinmis", codes.Aborted, `{"code":"REQUEST_IN_PROGRESS","message":"x","details":{"orderId":"o","paymentStatus":"SUCCEEDED"}}`, apperror.CodeRequestInProgress},
		{"baskasinin siparisi", codes.NotFound, `{"code":"NOT_FOUND","message":"x","details":{"orderId":"o"}}`, apperror.CodeNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := &stubServer{cancelErr: status.Error(tc.code, "x"), cancelTrailer: appErrorTrailer(tc.payload)}
			service := startStubAt(t, stub, fixedNow)

			_, err := service.Release(context.Background(), ReleaseInput{UserID: "usr_1", OrderID: orderID, IdempotencyKey: "k"})

			if appErr := testkit.AppErrorOf(t, err); appErr.Code != tc.want {
				t.Errorf("hata aynen yukari gitmeli: %+v", appErr)
			}
			if stub.getRequest != nil {
				t.Error("yalnizca \"zaten iptal\" yolunda siparis okunur")
			}
		})
	}
}

func TestReleaseRenamesIdempotencyKeyField(t *testing.T) {
	stub := &stubServer{
		cancelErr:     status.Error(codes.InvalidArgument, "x"),
		cancelTrailer: appErrorTrailer(`{"code":"VALIDATION_FAILED","message":"x","details":{"idempotencyKey":"zorunlu"}}`),
	}
	service := startStubAt(t, stub, fixedNow)

	_, err := service.Release(context.Background(), ReleaseInput{UserID: "usr_1", OrderID: orderID})

	if details := testkit.AppErrorOf(t, err).Details; details["Idempotency-Key"] != "zorunlu" {
		t.Errorf("anahtar alani basliktaki adla gorunmeli: %+v", details)
	}
}
