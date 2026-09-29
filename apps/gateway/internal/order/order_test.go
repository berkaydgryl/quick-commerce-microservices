package order

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"
	paymentv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/payment/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

func TestReserveMapsRequestAndResponse(t *testing.T) {
	stub := &stubServer{draftResponse: &orderv1.CreateDraftOrderResponse{
		OrderId: orderID,
		Status:  orderv1.OrderStatus_ORDER_STATUS_DRAFT,
	}}
	service := startStub(t, stub)

	reservation, err := service.Reserve(context.Background(), reserveInput())
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	sent := stub.draftRequest
	if sent.GetUserId() != "usr_1" || sent.GetMarketId() != "mkt_migros-jet-moda" || sent.GetIdempotencyKey() != "anahtar-0001" {
		t.Errorf("kimlik, market ve anahtar tasinmali: %v", sent)
	}
	line := sent.GetLines()[0]
	if line.GetProductId() != "prd_bulasik-deterjan" || line.GetQuantity() != 2 || line.GetSku() != "" {
		t.Errorf("kalem urun+adet tasimali, sku BOS gitmeli (catalog'dan okunur): %v", line)
	}
	if sent.GetDeliveryAddress() != "Kadikoy" || sent.GetDeliveryLocation().GetLat() != 40.99 {
		t.Errorf("adres ve konum tasinmali: %v", sent)
	}
	if sent.GetExpectedTotal().GetAmountMinor() != 19_360 || sent.GetCouponCode() != "ILK10" {
		t.Errorf("beklenen toplam ve kupon tasinmali: %v", sent)
	}
	// Stok rezervasyonu (T11.2) yok: expiresAt HIC yazilmamali.
	if got := testkit.JSON(t, reservation); got != `{"orderId":"`+orderID+`","status":"DRAFT"}` {
		t.Errorf("cevap: %s", got)
	}
}

func TestReserveDoesNotSendMissingLocationOrTotal(t *testing.T) {
	// Gonderilmeyen konum/tutar mesaj olarak da gitmemeli: servis "zorunlu"
	// desin, (0,0) ve 0 TL gecerli deger gibi tasinmasin.
	stub := &stubServer{draftResponse: &orderv1.CreateDraftOrderResponse{OrderId: orderID, Status: orderv1.OrderStatus_ORDER_STATUS_DRAFT}}
	service := startStub(t, stub)
	input := reserveInput()
	input.Location, input.ExpectedTotal = nil, nil

	if _, err := service.Reserve(context.Background(), input); err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if stub.draftRequest.GetDeliveryLocation() != nil || stub.draftRequest.GetExpectedTotal() != nil {
		t.Errorf("eksik mesajlar gonderilmemeliydi: %v", stub.draftRequest)
	}
}

func TestReserveKeepsNumericDetails(t *testing.T) {
	// T7.5: PRICE_CHANGED'in guncel toplami SAYI olarak istemciye ulasmali
	// (roadmap B13: "409 PRICE_CHANGED + guncel toplam").
	stub := &stubServer{
		err: status.Error(codes.Aborted, "fiyat degisti"),
		trailer: metadata.Pairs(apperror.MetadataKey,
			`{"code":"PRICE_CHANGED","message":"x","details":{"expectedTotalMinor":19000,"totalMinor":19360,"currency":"TRY"}}`),
	}
	service := startStub(t, stub)

	_, err := service.Reserve(context.Background(), reserveInput())

	appErr := testkit.AppErrorOf(t, err)
	if appErr.Code != apperror.CodePriceChanged {
		t.Fatalf("PRICE_CHANGED bekleniyordu, %s geldi", appErr.Code)
	}
	if got := testkit.JSON(t, appErr.Details); got != `{"currency":"TRY","expectedTotalMinor":19000,"totalMinor":19360}` {
		t.Errorf("ayrinti oldugu gibi gecmeli: %s", got)
	}
}

func TestPlaceSendsCardAndSignals(t *testing.T) {
	stub := &stubServer{placeResponse: &orderv1.CreateOrderResponse{
		OrderId:     orderID,
		Status:      orderv1.OrderStatus_ORDER_STATUS_AWAITING_PAYMENT,
		ChallengeId: "tds_1",
	}}
	service := startStub(t, stub)
	createdAt := time.Date(2026, 8, 30, 9, 0, 0, 0, time.UTC)

	placement, err := service.Place(context.Background(), PlaceInput{
		UserID: "usr_1", OrderID: orderID, CardToken: "tok_test_4242", IdempotencyKey: "anahtar-0002",
		Signals: Signals{
			IPAddress: "85.105.1.20", IPCity: "Istanbul", DeviceID: "dvc_1", AccountsOnDevice: 4,
			PreviousIPAddress: "85.105.1.19", SessionLocation: &rest.GeoPoint{Lat: 39.93, Lng: 32.86}, AccountCreatedAt: createdAt,
		},
	})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	sent := stub.placeRequest
	if sent.GetPaymentMethod() != paymentv1.PaymentMethod_PAYMENT_METHOD_CARD || sent.GetCardToken() != "tok_test_4242" {
		t.Errorf("kart yontemi ve jeton tasinmali: %v", sent)
	}
	// Risk sinyalleri (B9): yedi alanin hepsi gateway'den.
	signals := sent.GetSignals()
	if signals.GetIpAddress() != "85.105.1.20" || signals.GetIpCity() != "Istanbul" || signals.GetDeviceId() != "dvc_1" ||
		signals.GetAccountsOnDevice() != 4 || signals.GetPreviousIpAddress() != "85.105.1.19" ||
		signals.GetSessionLocation().GetLat() != 39.93 || signals.GetSessionLocation().GetLng() != 32.86 ||
		!signals.GetAccountCreatedAt().AsTime().Equal(createdAt) {
		t.Errorf("sinyallerin hepsi tasinmali: %v", signals)
	}
	if got := testkit.JSON(t, placement); got != `{"orderId":"`+orderID+`","status":"AWAITING_PAYMENT","threeDs":{"challengeId":"tds_1"}}` {
		t.Errorf("cevap: %s", got)
	}
}

func TestPlaceOmitsUnknownSignals(t *testing.T) {
	// Bilinmeyen konum ve hesap yasi GONDERILMEZ: risk sozlesmesinde "mesaj
	// yok = bilinmiyor"; sifir konum (0,0) ya da 1970 tarihi gercek deger sanilirdi.
	stub := &stubServer{placeResponse: &orderv1.CreateOrderResponse{
		OrderId: orderID, Status: orderv1.OrderStatus_ORDER_STATUS_PAID,
	}}
	service := startStub(t, stub)

	if _, err := service.Place(context.Background(), PlaceInput{
		UserID: "usr_1", OrderID: orderID, CardToken: "tok_test_4242", IdempotencyKey: "anahtar-0003",
		Signals: Signals{IPAddress: "85.105.1.20"},
	}); err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	signals := stub.placeRequest.GetSignals()
	if signals.GetIpAddress() != "85.105.1.20" || signals.GetSessionLocation() != nil || signals.GetAccountCreatedAt() != nil {
		t.Errorf("yalnizca bilinen sinyaller gitmeli: %v", signals)
	}
}

func TestPlaceWithoutChallengeOmitsThreeDs(t *testing.T) {
	stub := &stubServer{placeResponse: &orderv1.CreateOrderResponse{OrderId: orderID, Status: orderv1.OrderStatus_ORDER_STATUS_PAID}}
	service := startStub(t, stub)

	placement, err := service.Place(context.Background(), PlaceInput{UserID: "usr_1", OrderID: orderID, CardToken: "tok_test_4242", IdempotencyKey: "anahtar-0002"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if got := testkit.JSON(t, placement); got != `{"orderId":"`+orderID+`","status":"PAID"}` {
		t.Errorf("threeDs hic yazilmamali: %s", got)
	}
}

func TestConfirmThreeDSMapsCodeAndRenamesOTP(t *testing.T) {
	stub := &stubServer{}
	service := startStub(t, stub)

	placement, err := service.ConfirmThreeDS(context.Background(), ConfirmInput{
		UserID: "usr_1", OrderID: orderID, ChallengeID: "tds_1", Code: "123456", IdempotencyKey: "anahtar-0003",
	})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if stub.confirmRequest.GetCode() != "123456" || stub.confirmRequest.GetChallengeId() != "tds_1" {
		t.Errorf("kod ve jeton tasinmali: %v", stub.confirmRequest)
	}
	if placement.Status != "PAID" {
		t.Errorf("PAID bekleniyordu: %+v", placement)
	}

	stub.err = status.Error(codes.InvalidArgument, "gecersiz")
	stub.trailer = metadata.Pairs(apperror.MetadataKey, `{"code":"VALIDATION_FAILED","message":"x","details":{"code":"6 haneli kod olmali"}}`)
	_, err = service.ConfirmThreeDS(context.Background(), ConfirmInput{UserID: "usr_1", OrderID: orderID, ChallengeID: "tds_1", Code: "12", IdempotencyKey: "anahtar-0003"})
	if details := testkit.AppErrorOf(t, err).Details; details["otp"] != "6 haneli kod olmali" {
		t.Errorf("proto 'code' -> REST 'otp' bekleniyordu: %v", details)
	}
}
