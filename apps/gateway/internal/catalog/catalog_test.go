package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/assets"
)

// stubServer, gercek gRPC sunucusunda calisan sahte katalog. Sahte istemci
// yerine gercek sunucu kullaniliyor cunku asil test edilen sey trailer'in
// (x-app-error) telden gecip adaptore ulasmasi; sahte istemci bunu taklit ederdi.
type stubServer struct {
	catalogv1.UnimplementedCatalogServiceServer
	categories []*catalogv1.Category
	err        error
	trailer    metadata.MD
	delay      time.Duration
}

func (s *stubServer) ListCategories(ctx context.Context, _ *catalogv1.ListCategoriesRequest) (*catalogv1.ListCategoriesResponse, error) {
	if s.delay > 0 {
		select {
		case <-time.After(s.delay):
		case <-ctx.Done():
			return nil, status.FromContextError(ctx.Err()).Err()
		}
	}
	if s.trailer != nil {
		_ = grpc.SetTrailer(ctx, s.trailer)
	}
	if s.err != nil {
		return nil, s.err
	}
	return &catalogv1.ListCategoriesResponse{Categories: s.categories}, nil
}

const (
	testTimeout   = 200 * time.Millisecond
	testAssetBase = "https://cdn.example"
)

// startStub, bellek ici baglantida sunucuyu kurar ve adaptoru dondurur.
// Her sahte katalog sunucusunu kabul eder (kategori ve pazaryeri testleri).
func startStub(t *testing.T, stub catalogv1.CatalogServiceServer) *Service {
	t.Helper()

	listener := bufconn.Listen(1 << 20)
	server := grpc.NewServer()
	catalogv1.RegisterCatalogServiceServer(server, stub)
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(server.Stop)

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return listener.DialContext(ctx)
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("istemci kurulamadi: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	return New(catalogv1.NewCatalogServiceClient(conn), testTimeout, testResolver(t))
}

// testResolver, gercek cozumleyici: ceviri kuralinin kendisi assets paketinde
// test edilir; burada adaptorun onu GERCEKTEN uyguladigi dogrulanir.
func testResolver(t *testing.T) assets.Resolver {
	t.Helper()
	base, err := url.Parse(testAssetBase)
	if err != nil {
		t.Fatalf("kok adres: %v", err)
	}
	return assets.NewResolver(base)
}

func appErrorOf(t *testing.T, err error) *apperror.Error {
	t.Helper()
	var appErr *apperror.Error
	if !errors.As(err, &appErr) {
		t.Fatalf("*apperror.Error bekleniyordu, %T geldi: %v", err, err)
	}
	return appErr
}

func TestListCategoriesMapsFields(t *testing.T) {
	service := startStub(t, &stubServer{categories: []*catalogv1.Category{
		// Veri GORELI yol tasir (catalog seed'i boyle yazar); cevaba mutlak gider.
		{Id: "cat_1", Name: "Süt", Slug: "sut", SortOrder: 1, ImageUrl: "/img/cat/sut.png"},
		{Id: "cat_2", Name: "Manav", Slug: "manav", SortOrder: 2},
	}})

	list, err := service.ListCategories(context.Background())
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	encoded, _ := json.Marshal(list)
	// Bos imageUrl HIC yazilmamali (sozlesmede url() dogrulamasi var); alan
	// adlari camelCase olmali.
	want := `{"items":[{"id":"cat_1","name":"Süt","slug":"sut","imageUrl":"https://cdn.example/img/cat/sut.png","sortOrder":1},{"id":"cat_2","name":"Manav","slug":"manav","sortOrder":2}]}`
	if string(encoded) != want {
		t.Errorf("JSON:\n got %s\nwant %s", encoded, want)
	}
}

func TestListCategoriesEmptyIsArrayNotNull(t *testing.T) {
	service := startStub(t, &stubServer{})

	list, err := service.ListCategories(context.Background())
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if encoded, _ := json.Marshal(list); string(encoded) != `{"items":[]}` {
		t.Errorf("bos liste [] olmali, %s geldi", encoded)
	}
}

func TestListCategoriesReadsAppErrorTrailer(t *testing.T) {
	// Servis is anlamini x-app-error'da tasir; gRPC kodu (NOT_FOUND) tek basina
	// NO_STORE ile NOT_FOUND'u ayiramazdi.
	service := startStub(t, &stubServer{
		err:     status.Error(codes.NotFound, "no store"),
		trailer: metadata.Pairs(apperror.MetadataKey, `{"code":"NO_STORE","message":"no store","details":{"reason":"STORE_CLOSED"}}`),
	})

	_, err := service.ListCategories(context.Background())

	appErr := appErrorOf(t, err)
	if appErr.Code != apperror.CodeNoStore {
		t.Errorf("NO_STORE bekleniyordu, %s geldi", appErr.Code)
	}
	if appErr.Details["reason"] != "STORE_CLOSED" {
		t.Errorf("details tasinmadi: %v", appErr.Details)
	}
}

func TestListCategoriesFallsBackToStatusCode(t *testing.T) {
	// Yuk yoksa (bizim olmayan sunucu, ag hatasi) durum kodundan turetilir.
	service := startStub(t, &stubServer{err: status.Error(codes.Unavailable, "down")})

	_, err := service.ListCategories(context.Background())

	if code := appErrorOf(t, err).Code; code != apperror.CodeServiceUnavailable {
		t.Errorf("SERVICE_UNAVAILABLE bekleniyordu, %s geldi", code)
	}
}

func TestListCategoriesAppliesTimeout(t *testing.T) {
	// Takilan servis gateway'i adaptorun son tarihinden fazla bekletmemeli.
	service := startStub(t, &stubServer{delay: time.Second})

	startedAt := time.Now()
	_, err := service.ListCategories(context.Background())

	if elapsed := time.Since(startedAt); elapsed > 3*testTimeout {
		t.Errorf("zaman asimi uygulanmadi, %v surdu", elapsed)
	}
	if code := appErrorOf(t, err).Code; code != apperror.CodeServiceUnavailable {
		t.Errorf("DeadlineExceeded SERVICE_UNAVAILABLE olmali, %s geldi", code)
	}
}
