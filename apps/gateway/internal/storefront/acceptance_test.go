package storefront

// Kabul testleri: GERCEK katalog ve stok adaptorleri, bellek ici gRPC
// sunuculari uzerinden (ag yok). Kurallar products_test.go'da sahte
// kaynaklarla; burada telden gecen cagri sayisi ve suresi sinanir.

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/status"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"
	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"
	inventoryv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/inventory/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/inventory"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

const catalogTimeout = time.Second

// catalogServer, sayfasi sabit sahte katalog.
type catalogServer struct {
	catalogv1.UnimplementedCatalogServiceServer
	offers []*catalogv1.Offer
}

func (s *catalogServer) ListProducts(context.Context, *catalogv1.ListProductsRequest) (*catalogv1.ListProductsResponse, error) {
	return &catalogv1.ListProductsResponse{Offers: s.offers, Page: &commonv1.PageResponse{}}, nil
}

// inventoryServer, her SKU'ya 7 adet veren sahte stok servisi; cagrilari sayar.
type inventoryServer struct {
	inventoryv1.UnimplementedInventoryServiceServer
	delay time.Duration

	mu    sync.Mutex
	calls []*inventoryv1.CheckAvailabilityRequest
}

func (s *inventoryServer) CheckAvailability(ctx context.Context, in *inventoryv1.CheckAvailabilityRequest) (*inventoryv1.CheckAvailabilityResponse, error) {
	s.mu.Lock()
	s.calls = append(s.calls, in)
	s.mu.Unlock()
	if s.delay > 0 {
		select {
		case <-time.After(s.delay):
		case <-ctx.Done():
			return nil, status.FromContextError(ctx.Err()).Err()
		}
	}
	items := make([]*inventoryv1.AvailabilityItem, 0, len(in.GetSkus()))
	for _, sku := range in.GetSkus() {
		items = append(items, &inventoryv1.AvailabilityItem{Sku: sku, AvailableQuantity: 7})
	}
	return &inventoryv1.CheckAvailabilityResponse{Items: items}, nil
}

func (s *inventoryServer) recorded() []*inventoryv1.CheckAvailabilityRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]*inventoryv1.CheckAvailabilityRequest(nil), s.calls...)
}

// plainImages, gorsel yolunu oldugu gibi birakir (kural assets paketinde sinanir).
type plainImages struct{}

func (plainImages) Resolve(path string) string { return path }

func offers(count int) []*catalogv1.Offer {
	list := make([]*catalogv1.Offer, 0, count)
	for i := range count {
		sku := fmt.Sprintf("SKU-%02d", i)
		list = append(list, &catalogv1.Offer{Id: "ofr_" + sku, MarketId: testMarket, ProductId: "prd_" + sku, Sku: sku, IsActive: true})
	}
	return list
}

// realProducts, gercek adaptorlerle kurulan urun listesi.
func realProducts(t *testing.T, catalogStub *catalogServer, inventoryStub *inventoryServer, stockTimeout time.Duration, logger *slog.Logger) *Products {
	t.Helper()
	catalogConn := testkit.BufconnClient(t, func(server *grpc.Server) {
		catalogv1.RegisterCatalogServiceServer(server, catalogStub)
	})
	inventoryConn := testkit.BufconnClient(t, func(server *grpc.Server) {
		inventoryv1.RegisterInventoryServiceServer(server, inventoryStub)
	})
	return NewProducts(
		catalog.New(catalogv1.NewCatalogServiceClient(catalogConn), catalogTimeout, plainImages{}),
		inventory.New(inventoryv1.NewInventoryServiceClient(inventoryConn), stockTimeout),
		logger,
	)
}

func TestFifteenProductsNeedOneStockCall(t *testing.T) {
	// Roadmap kabul testi B27: 15 urunluk liste TEK CheckAvailability ile doner
	// (N+1 yok).
	inventoryStub := &inventoryServer{}
	lister := realProducts(t, &catalogServer{offers: offers(15)}, inventoryStub, time.Second, slog.New(slog.DiscardHandler))

	page, err := lister.MarketProducts(context.Background(), catalog.ProductQuery{MarketID: testMarket})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	calls := inventoryStub.recorded()
	if len(calls) != 1 {
		t.Fatalf("tek stok cagrisi bekleniyordu, %d geldi", len(calls))
	}
	if calls[0].GetMarketId() != testMarket || len(calls[0].GetSkus()) != 15 {
		t.Errorf("tek cagri butun sayfayi sormali: market %q, %d SKU", calls[0].GetMarketId(), len(calls[0].GetSkus()))
	}
	for _, item := range page.Items {
		if item.AvailableQuantity == nil || *item.AvailableQuantity != 7 {
			t.Errorf("%s urununde adet yok ya da yanlis: %v", item.SKU, item.AvailableQuantity)
		}
	}
}

func TestSlowStockServiceDoesNotHoldTheList(t *testing.T) {
	// Stok servisi takilirsa liste kendi siniri kadar bekler, sonra STOKSUZ doner.
	const stockTimeout = 100 * time.Millisecond
	var logs bytes.Buffer
	lister := realProducts(t, &catalogServer{offers: offers(3)}, &inventoryServer{delay: 2 * time.Second},
		stockTimeout, slog.New(slog.NewJSONHandler(&logs, nil)))

	startedAt := time.Now()
	page, err := lister.MarketProducts(context.Background(), catalog.ProductQuery{MarketID: testMarket})
	elapsed := time.Since(startedAt)

	if err != nil {
		t.Fatalf("yavas stok listeyi dusurmemeli: %v", err)
	}
	if elapsed > 5*stockTimeout {
		t.Errorf("liste stok sinirindan fazla bekledi: %v", elapsed)
	}
	if len(page.Items) != 3 {
		t.Fatalf("urunler donmeli: %+v", page)
	}
	if encoded := testkit.JSON(t, page); strings.Contains(encoded, "availableQuantity") {
		t.Errorf("sure asilinca stok alani yazilmamali: %s", encoded)
	}
	if !strings.Contains(logs.String(), "stok okunamadi") {
		t.Errorf("sure asimi gunluge yazilmali: %s", logs.String())
	}
}
