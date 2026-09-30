package storefront

// Genel aramanin kabul testleri (T9.6): GERCEK katalog ve stok adaptorleri,
// bellek ici gRPC sunuculari uzerinden. Kurallar search_test.go'da sahte
// kaynaklarla; burada telden gecen cagri sayisi, paralellik ve sure sinanir.

import (
	"bytes"
	"context"
	"log/slog"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/status"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"
	inventoryv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/inventory/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/inventory"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// searchCatalogServer, sonucu sabit sahte genel arama.
type searchCatalogServer struct {
	catalogv1.UnimplementedCatalogServiceServer
	results []*catalogv1.MarketSearchResult
}

func (s *searchCatalogServer) SearchNearby(context.Context, *catalogv1.SearchNearbyRequest) (*catalogv1.SearchNearbyResponse, error) {
	return &catalogv1.SearchNearbyResponse{Results: s.results}, nil
}

// marketInventory, her SKU'ya 7 adet veren sahte stok servisi.
//   - barrier > 0: her cagri, o kadar cagri gelene kadar cevap vermez. Cagrilar
//     SIRAYLA yapilsaydi ilki hic cevap alamaz, sure siniri dolardi: paralellik
//     sureye bakmadan boyle sinanir.
//   - delays: market basina gecikme.
type marketInventory struct {
	inventoryv1.UnimplementedInventoryServiceServer
	barrier int
	delays  map[string]time.Duration

	mu      sync.Mutex
	calls   []*inventoryv1.CheckAvailabilityRequest
	allHere chan struct{}
}

func newMarketInventory(barrier int, delays map[string]time.Duration) *marketInventory {
	return &marketInventory{barrier: barrier, delays: delays, allHere: make(chan struct{})}
}

func (s *marketInventory) CheckAvailability(ctx context.Context, in *inventoryv1.CheckAvailabilityRequest) (*inventoryv1.CheckAvailabilityResponse, error) {
	s.mu.Lock()
	s.calls = append(s.calls, in)
	if len(s.calls) == s.barrier {
		close(s.allHere)
	}
	s.mu.Unlock()

	if s.barrier > 0 {
		if err := wait(ctx, s.allHere); err != nil {
			return nil, err
		}
	}
	if delay := s.delays[in.GetMarketId()]; delay > 0 {
		if err := wait(ctx, time.After(delay)); err != nil {
			return nil, err
		}
	}
	items := make([]*inventoryv1.AvailabilityItem, 0, len(in.GetSkus()))
	for _, sku := range in.GetSkus() {
		items = append(items, &inventoryv1.AvailabilityItem{Sku: sku, AvailableQuantity: 7})
	}
	return &inventoryv1.CheckAvailabilityResponse{Items: items}, nil
}

func (s *marketInventory) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.calls)
}

func (s *marketInventory) recorded() map[string][]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	asked := make(map[string][]string, len(s.calls))
	for _, call := range s.calls {
		asked[call.GetMarketId()] = call.GetSkus()
	}
	return asked
}

// wait, kanal ya da istek (sure siniri, iptal) hangisi once biterse.
func wait[T any](ctx context.Context, done <-chan T) error {
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return status.FromContextError(ctx.Err()).Err()
	}
}

// marketResult, bir markette verilen SKU'lar kadar teklif.
func marketResult(marketID string, skus ...string) *catalogv1.MarketSearchResult {
	offers := make([]*catalogv1.Offer, 0, len(skus))
	for _, sku := range skus {
		offers = append(offers, &catalogv1.Offer{Id: "ofr_" + sku, MarketId: marketID, ProductId: "prd_" + sku, Sku: sku, IsActive: true})
	}
	return &catalogv1.MarketSearchResult{
		Market:            &catalogv1.NearbyMarket{Market: &catalogv1.Market{Id: marketID}},
		Offers:            offers,
		TotalOfferMatches: int32(len(skus)),
	}
}

// realSearch, gercek adaptorlerle kurulan genel arama.
func realSearch(t *testing.T, catalogStub *searchCatalogServer, inventoryStub *marketInventory, stockTimeout time.Duration, logger *slog.Logger) *Search {
	t.Helper()
	catalogConn := testkit.BufconnClient(t, func(server *grpc.Server) {
		catalogv1.RegisterCatalogServiceServer(server, catalogStub)
	})
	inventoryConn := testkit.BufconnClient(t, func(server *grpc.Server) {
		inventoryv1.RegisterInventoryServiceServer(server, inventoryStub)
	})
	return NewSearch(
		catalog.New(catalogv1.NewCatalogServiceClient(catalogConn), catalogTimeout, plainImages{}),
		inventory.New(inventoryv1.NewInventoryServiceClient(inventoryConn), stockTimeout),
		logger,
	)
}

func TestSearchStockCallsRunInParallel(t *testing.T) {
	// Uc market, market basina bir stok cagrisi; stok servisi ucu de gelmeden
	// cevap vermez. Sirayla yapilan cagrilarda ilki sure sinirina takilirdi.
	catalogStub := &searchCatalogServer{results: []*catalogv1.MarketSearchResult{
		marketResult(a101Market, "CIKOLATA-80", "SUT-1L"),
		marketResult(testMarket, "CIKOLATA-80", "SUT-1L"),
		marketResult(manavMarket, "MUZ-1K"),
	}}
	inventoryStub := newMarketInventory(3, nil)
	var logs bytes.Buffer
	search := realSearch(t, catalogStub, inventoryStub, 500*time.Millisecond, slog.New(slog.NewJSONHandler(&logs, nil)))

	list, err := search.Search(context.Background(), catalog.SearchQuery{Lat: 40.9885, Lng: 29.0262, Query: "süt"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	for key, quantity := range stockOf(list) {
		if quantity != 7 {
			t.Errorf("%s: adet 7 bekleniyordu, %d (cagrilar paralel degil mi?)", key, quantity)
		}
	}
	want := map[string][]string{
		a101Market:  {"CIKOLATA-80", "SUT-1L"},
		testMarket:  {"CIKOLATA-80", "SUT-1L"},
		manavMarket: {"MUZ-1K"},
	}
	if calls := inventoryStub.callCount(); calls != len(want) {
		t.Errorf("market basina TEK cagri: %d market, %d cagri", len(want), calls)
	}
	if got := inventoryStub.recorded(); !reflect.DeepEqual(got, want) {
		t.Errorf("her cagri o marketin SKU'lariyla: %v", got)
	}
	if logs.Len() != 0 {
		t.Errorf("gunluk yazilmamali: %s", logs.String())
	}
}

func TestSearchSlowMarketStockOnlyAffectsThatMarket(t *testing.T) {
	// Migros'un stok cagrisi takiliyor: arama stok sinirinda doner, yalnizca
	// Migros'un urunleri stoksuz.
	const stockTimeout = 100 * time.Millisecond
	catalogStub := &searchCatalogServer{results: []*catalogv1.MarketSearchResult{
		marketResult(a101Market, "SUT-1L"),
		marketResult(testMarket, "SUT-1L"),
	}}
	inventoryStub := newMarketInventory(0, map[string]time.Duration{testMarket: 2 * time.Second})
	var logs bytes.Buffer
	search := realSearch(t, catalogStub, inventoryStub, stockTimeout, slog.New(slog.NewJSONHandler(&logs, nil)))

	startedAt := time.Now()
	list, err := search.Search(context.Background(), catalog.SearchQuery{Lat: 40.9885, Lng: 29.0262, Query: "süt"})
	elapsed := time.Since(startedAt)

	if err != nil {
		t.Fatalf("yavas stok aramayi dusurmemeli: %v", err)
	}
	if elapsed > 5*stockTimeout {
		t.Errorf("arama stok sinirindan fazla bekledi: %v", elapsed)
	}
	if got := stockOf(list); got[a101Market+"/SUT-1L"] != 7 || got[testMarket+"/SUT-1L"] != -1 {
		t.Errorf("yalnizca Migros stoksuz olmali: %v", got)
	}
	if !strings.Contains(logs.String(), "stok okunamadi") || !strings.Contains(logs.String(), testMarket) {
		t.Errorf("sure asimi o marketle gunluge yazilmali: %s", logs.String())
	}
}
