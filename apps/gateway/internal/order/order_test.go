package order

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"
	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"
	paymentv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/payment/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

// stubServer, gercek gRPC sunucusunda calisan sahte order. Asil test edilen
// sey istegin ve trailer'in (x-app-error) telden gecip adaptore ulasmasi;
// sahte istemci bunu taklit ederdi.
type stubServer struct {
	orderv1.UnimplementedOrderServiceServer

	draftRequest   *orderv1.CreateDraftOrderRequest
	placeRequest   *orderv1.CreateOrderRequest
	confirmRequest *orderv1.ConfirmPaymentRequest
	getRequest     *orderv1.GetOrderRequest

	draftResponse *orderv1.CreateDraftOrderResponse
	placeResponse *orderv1.CreateOrderResponse
	order         *orderv1.Order

	err     error
	trailer metadata.MD
}

// fail, sahte hatayi (ve varsa x-app-error trailer'ini) dondurur.
func (s *stubServer) fail(ctx context.Context) error {
	if s.trailer != nil {
		if err := grpc.SetTrailer(ctx, s.trailer); err != nil {
			return err
		}
	}
	return s.err
}

func (s *stubServer) CreateDraftOrder(ctx context.Context, in *orderv1.CreateDraftOrderRequest) (*orderv1.CreateDraftOrderResponse, error) {
	s.draftRequest = in
	if s.err != nil {
		return nil, s.fail(ctx)
	}
	return s.draftResponse, nil
}

func (s *stubServer) CreateOrder(ctx context.Context, in *orderv1.CreateOrderRequest) (*orderv1.CreateOrderResponse, error) {
	s.placeRequest = in
	if s.err != nil {
		return nil, s.fail(ctx)
	}
	return s.placeResponse, nil
}

func (s *stubServer) ConfirmPayment(ctx context.Context, in *orderv1.ConfirmPaymentRequest) (*orderv1.ConfirmPaymentResponse, error) {
	s.confirmRequest = in
	if s.err != nil {
		return nil, s.fail(ctx)
	}
	return &orderv1.ConfirmPaymentResponse{OrderId: in.GetOrderId(), Status: orderv1.OrderStatus_ORDER_STATUS_PAID}, nil
}

func (s *stubServer) GetOrder(ctx context.Context, in *orderv1.GetOrderRequest) (*orderv1.GetOrderResponse, error) {
	s.getRequest = in
	if s.err != nil {
		return nil, s.fail(ctx)
	}
	return &orderv1.GetOrderResponse{Order: s.order}, nil
}

const (
	testTimeout = 500 * time.Millisecond
	orderID     = "ord_db77f4c0e24f49919cc1d78a649c9c94"
)

// startStub, bellek ici baglantida sunucuyu kurar ve adaptoru dondurur.
func startStub(t *testing.T, stub *stubServer) *Service {
	t.Helper()

	listener := bufconn.Listen(1 << 20)
	server := grpc.NewServer()
	orderv1.RegisterOrderServiceServer(server, stub)
	serveErr := make(chan error, 1)
	go func() { serveErr <- server.Serve(listener) }()
	t.Cleanup(func() {
		server.Stop()
		if err := <-serveErr; err != nil && !errors.Is(err, grpc.ErrServerStopped) {
			t.Errorf("sunucu hatayla durdu: %v", err)
		}
	})

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return listener.DialContext(ctx)
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("istemci kurulamadi: %v", err)
	}
	t.Cleanup(func() {
		if closeErr := conn.Close(); closeErr != nil {
			t.Errorf("baglanti kapanmadi: %v", closeErr)
		}
	})

	return New(orderv1.NewOrderServiceClient(conn), testTimeout)
}

func appErrorOf(t *testing.T, err error) *apperror.Error {
	t.Helper()
	var appErr *apperror.Error
	if !errors.As(err, &appErr) {
		t.Fatalf("*apperror.Error bekleniyordu, %T geldi: %v", err, err)
	}
	return appErr
}

func jsonOf(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("json kodlanamadi: %v", err)
	}
	return string(encoded)
}

func reserveInput() ReserveInput {
	return ReserveInput{
		UserID:         "usr_1",
		MarketID:       "mkt_migros-jet-moda",
		Items:          []CartItem{{ProductID: "prd_bulasik-deterjan", Quantity: 2}},
		AddressLine:    "Kadikoy",
		Location:       &rest.GeoPoint{Lat: 40.99, Lng: 29.02},
		ExpectedTotal:  &rest.Money{AmountMinor: 19_360, Currency: "TRY"},
		CouponCode:     "ILK10",
		IdempotencyKey: "anahtar-0001",
	}
}

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
	if got := jsonOf(t, reservation); got != `{"orderId":"`+orderID+`","status":"DRAFT"}` {
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

func TestReserveRenamesProtoFieldsToRestFields(t *testing.T) {
	stub := &stubServer{
		err: status.Error(codes.InvalidArgument, "gecersiz"),
		trailer: metadata.Pairs(apperror.MetadataKey,
			`{"code":"VALIDATION_FAILED","message":"x","details":{"lines.0.quantity":"en fazla 99","deliveryLocation.lat":"en fazla 90","deliveryAddress":"zorunlu","idempotencyKey":"en az 8","marketId":"gecersiz"}}`),
	}
	service := startStub(t, stub)

	_, err := service.Reserve(context.Background(), reserveInput())

	details := appErrorOf(t, err).Details
	want := map[string]string{
		"items.0.quantity":     "en fazla 99",
		"address.location.lat": "en fazla 90",
		"address.line":         "zorunlu",
		"Idempotency-Key":      "en az 8",
		"marketId":             "gecersiz",
	}
	for field, reason := range want {
		if details[field] != reason {
			t.Errorf("%s = %v, %q bekleniyordu (tum details: %v)", field, details[field], reason, details)
		}
	}
	if len(details) != len(want) {
		t.Errorf("proto adlari kalmamali: %v", details)
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

	appErr := appErrorOf(t, err)
	if appErr.Code != apperror.CodePriceChanged {
		t.Fatalf("PRICE_CHANGED bekleniyordu, %s geldi", appErr.Code)
	}
	if got := jsonOf(t, appErr.Details); got != `{"currency":"TRY","expectedTotalMinor":19000,"totalMinor":19360}` {
		t.Errorf("ayrinti oldugu gibi gecmeli: %s", got)
	}
}

func TestPlaceSendsCardAndClientIP(t *testing.T) {
	stub := &stubServer{placeResponse: &orderv1.CreateOrderResponse{
		OrderId:     orderID,
		Status:      orderv1.OrderStatus_ORDER_STATUS_AWAITING_PAYMENT,
		ChallengeId: "tds_1",
	}}
	service := startStub(t, stub)

	placement, err := service.Place(context.Background(), PlaceInput{
		UserID: "usr_1", OrderID: orderID, CardToken: "tok_test_4242", IdempotencyKey: "anahtar-0002", ClientIP: "85.105.1.20",
	})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	sent := stub.placeRequest
	if sent.GetPaymentMethod() != paymentv1.PaymentMethod_PAYMENT_METHOD_CARD || sent.GetCardToken() != "tok_test_4242" {
		t.Errorf("kart yontemi ve jeton tasinmali: %v", sent)
	}
	// Risk sinyali (B9): IP gateway'den, digerleri T8.1'e kadar BOS.
	if sent.GetSignals().GetIpAddress() != "85.105.1.20" || sent.GetSignals().GetDeviceId() != "" {
		t.Errorf("yalnizca IP sinyali gitmeli: %v", sent.GetSignals())
	}
	if got := jsonOf(t, placement); got != `{"orderId":"`+orderID+`","status":"AWAITING_PAYMENT","threeDs":{"challengeId":"tds_1"}}` {
		t.Errorf("cevap: %s", got)
	}
}

func TestPlaceWithoutChallengeOmitsThreeDs(t *testing.T) {
	stub := &stubServer{placeResponse: &orderv1.CreateOrderResponse{OrderId: orderID, Status: orderv1.OrderStatus_ORDER_STATUS_PAID}}
	service := startStub(t, stub)

	placement, err := service.Place(context.Background(), PlaceInput{UserID: "usr_1", OrderID: orderID, CardToken: "tok_test_4242", IdempotencyKey: "anahtar-0002"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if got := jsonOf(t, placement); got != `{"orderId":"`+orderID+`","status":"PAID"}` {
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
	if details := appErrorOf(t, err).Details; details["otp"] != "6 haneli kod olmali" {
		t.Errorf("proto 'code' -> REST 'otp' bekleniyordu: %v", details)
	}
}

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
	if got := jsonOf(t, found); got != want {
		t.Errorf("siparis:\n got %s\nwant %s", got, want)
	}
}

func TestUnknownStatusIsInternal(t *testing.T) {
	// Servis sozlesmeyi bozarsa (UNSPECIFIED) istemciye uydurma durum gitmemeli.
	stub := &stubServer{placeResponse: &orderv1.CreateOrderResponse{OrderId: orderID}}
	service := startStub(t, stub)

	_, err := service.Place(context.Background(), PlaceInput{UserID: "usr_1", OrderID: orderID, CardToken: "tok", IdempotencyKey: "anahtar-0002"})

	if code := appErrorOf(t, err).Code; code != apperror.CodeInternal {
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
