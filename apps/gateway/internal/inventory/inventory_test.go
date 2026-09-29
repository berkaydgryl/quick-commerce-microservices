package inventory

import (
	"context"
	"reflect"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	inventoryv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/inventory/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// stubServer, gercek gRPC sunucusunda calisan sahte stok servisi. Asil test
// edilen sey istegin ve trailer'in (x-app-error) telden gecip adaptore ulasmasi.
type stubServer struct {
	inventoryv1.UnimplementedInventoryServiceServer
	response *inventoryv1.CheckAvailabilityResponse
	err      error
	trailer  metadata.MD
	delay    time.Duration
	got      *inventoryv1.CheckAvailabilityRequest
}

func (s *stubServer) CheckAvailability(ctx context.Context, in *inventoryv1.CheckAvailabilityRequest) (*inventoryv1.CheckAvailabilityResponse, error) {
	s.got = in
	if s.delay > 0 {
		select {
		case <-time.After(s.delay):
		case <-ctx.Done():
			return nil, status.FromContextError(ctx.Err()).Err()
		}
	}
	if s.trailer != nil {
		if err := grpc.SetTrailer(ctx, s.trailer); err != nil {
			return nil, err
		}
	}
	if s.err != nil {
		return nil, s.err
	}
	return s.response, nil
}

const testTimeout = 200 * time.Millisecond

func startStub(t *testing.T, stub *stubServer) *Service {
	t.Helper()
	conn := testkit.BufconnClient(t, func(server *grpc.Server) {
		inventoryv1.RegisterInventoryServiceServer(server, stub)
	})
	return New(inventoryv1.NewInventoryServiceClient(conn), testTimeout)
}

func TestAvailabilityMapsQuantitiesAndUnknown(t *testing.T) {
	stub := &stubServer{response: &inventoryv1.CheckAvailabilityResponse{
		Items: []*inventoryv1.AvailabilityItem{
			{Sku: "SUT-1L", AvailableQuantity: 24},
			{Sku: "KOLA-1L", AvailableQuantity: 0},
		},
		UnknownSkus: []string{"YOK-1"},
	}}
	service := startStub(t, stub)

	got, err := service.Availability(context.Background(), "mkt_migros-jet-moda", []string{"SUT-1L", "KOLA-1L", "YOK-1"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	// 0 da bir adettir ("tukendi"): haritada VAR olmali, "kaydi yok"tan ayrilir.
	want := Availability{Quantities: map[string]int32{"SUT-1L": 24, "KOLA-1L": 0}, Unknown: []string{"YOK-1"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("cevap:\n got %+v\nwant %+v", got, want)
	}
	// Istek market_id ile gider; kullanimdan kalkan dark_store_id doldurulmaz.
	if stub.got.GetMarketId() != "mkt_migros-jet-moda" || stub.got.GetDarkStoreId() != "" ||
		!reflect.DeepEqual(stub.got.GetSkus(), []string{"SUT-1L", "KOLA-1L", "YOK-1"}) {
		t.Errorf("istek servise dogru tasinmadi: %v", stub.got)
	}
}

func TestAvailabilityReadsAppErrorTrailer(t *testing.T) {
	service := startStub(t, &stubServer{
		err:     status.Error(codes.InvalidArgument, "gecersiz"),
		trailer: metadata.Pairs(apperror.MetadataKey, `{"code":"VALIDATION_FAILED","message":"x","details":{"skus":"en fazla 100 sku"}}`),
	})

	_, err := service.Availability(context.Background(), "mkt_x", []string{"A"})

	appErr := testkit.AppErrorOf(t, err)
	if appErr.Code != apperror.CodeValidationFailed || appErr.Details["skus"] != "en fazla 100 sku" {
		t.Errorf("servisin hatasi korunmali: %+v", appErr)
	}
}

func TestAvailabilityUnreachableServiceIsServiceUnavailable(t *testing.T) {
	// Servis kapali: yuk yok, kod durumdan turetilir. Cagiran (storefront)
	// bunu "stok bilgisi yok" diye isler.
	service := startStub(t, &stubServer{err: status.Error(codes.Unavailable, "down")})

	_, err := service.Availability(context.Background(), "mkt_x", []string{"A"})

	if code := testkit.AppErrorOf(t, err).Code; code != apperror.CodeServiceUnavailable {
		t.Errorf("SERVICE_UNAVAILABLE bekleniyordu, %s geldi", code)
	}
}

func TestAvailabilityAppliesTimeout(t *testing.T) {
	// Takilan stok servisi urun listesini adaptorun son tarihinden fazla bekletmemeli.
	service := startStub(t, &stubServer{delay: time.Second})

	startedAt := time.Now()
	_, err := service.Availability(context.Background(), "mkt_x", []string{"A"})

	if elapsed := time.Since(startedAt); elapsed > 3*testTimeout {
		t.Errorf("zaman asimi uygulanmadi, %v surdu", elapsed)
	}
	if code := testkit.AppErrorOf(t, err).Code; code != apperror.CodeServiceUnavailable {
		t.Errorf("DeadlineExceeded SERVICE_UNAVAILABLE olmali, %s geldi", code)
	}
}
