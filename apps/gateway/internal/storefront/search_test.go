package storefront

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/inventory"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

const (
	a101Market  = "mkt_a101-caferaga"
	manavMarket = "mkt_kardesler-manavi"
)

// fakeSearchCatalog, katalogun genel aramasi ya da hatasi.
type fakeSearchCatalog struct {
	list catalog.SearchResultList
	err  error
}

func (f *fakeSearchCatalog) Search(context.Context, catalog.SearchQuery) (catalog.SearchResultList, error) {
	return f.list, f.err
}

// marketStock, market basina stok cevabi. Cagrilar PARALEL geldigi icin kayit kilitli.
type marketStock struct {
	availability map[string]inventory.Availability
	failing      map[string]error

	mu    sync.Mutex
	asked map[string][]string
}

func (m *marketStock) Availability(_ context.Context, marketID string, skus []string) (inventory.Availability, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.asked == nil {
		m.asked = map[string][]string{}
	}
	m.asked[marketID] = skus
	if err := m.failing[marketID]; err != nil {
		return inventory.Availability{}, err
	}
	return m.availability[marketID], nil
}

func (m *marketStock) askedMarkets() map[string][]string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.asked
}

// found, bir markette sonuc: verilen SKU'lar urun, toplam urun sayisi kadar.
func found(marketID string, skus ...string) catalog.SearchResult {
	products := make([]catalog.Product, 0, len(skus))
	for _, sku := range skus {
		products = append(products, catalog.Product{OfferID: "ofr_" + strings.ToLower(sku), MarketID: marketID, SKU: sku, IsActive: true})
	}
	return catalog.SearchResult{
		NearbyMarket:        catalog.NearbyMarket{Market: catalog.Market{ID: marketID}},
		Products:            products,
		TotalProductMatches: int32(len(skus)),
	}
}

// nameOnly, yalnizca adi eslesen market: urun yok.
func nameOnly(marketID string) catalog.SearchResult {
	return catalog.SearchResult{
		NearbyMarket:      catalog.NearbyMarket{Market: catalog.Market{ID: marketID}},
		MarketNameMatched: true,
		Products:          []catalog.Product{},
	}
}

// results, katalogun dondurdugu liste; adaptor gibi bos listeyi de [] kurar.
func results(items ...catalog.SearchResult) catalog.SearchResultList {
	return catalog.SearchResultList{Items: append([]catalog.SearchResult{}, items...)}
}

// stockOf, sonuctaki her urunun adedi "market/SKU" anahtariyla; stok bilgisi yoksa -1.
func stockOf(list catalog.SearchResultList) map[string]int32 {
	got := map[string]int32{}
	for _, result := range list.Items {
		for _, product := range result.Products {
			key := result.Market.ID + "/" + product.SKU
			if product.AvailableQuantity == nil {
				got[key] = -1
				continue
			}
			got[key] = *product.AvailableQuantity
		}
	}
	return got
}

func marketOrder(list catalog.SearchResultList) []string {
	ids := make([]string, 0, len(list.Items))
	for _, result := range list.Items {
		ids = append(ids, result.Market.ID)
	}
	return ids
}

func TestSearchAsksStockOncePerMarketWithProducts(t *testing.T) {
	// Ayni urun iki markette FARKLI adette: adet market basina sorulur ve o
	// marketin urunune yazilir. Yalnizca adi eslesen manav icin stok sorulmaz.
	stock := &marketStock{availability: map[string]inventory.Availability{
		a101Market: {Quantities: map[string]int32{"CIKOLATA-80": 5, "SUT-1L": 0}},
		testMarket: {Quantities: map[string]int32{"CIKOLATA-80": 9, "SUT-1L": 24}},
	}}
	var logs bytes.Buffer
	search := NewSearch(&fakeSearchCatalog{list: results(
		found(a101Market, "CIKOLATA-80", "SUT-1L"),
		found(testMarket, "CIKOLATA-80", "SUT-1L"),
		nameOnly(manavMarket),
	)}, stock, slog.New(slog.NewJSONHandler(&logs, nil)))

	list, err := search.Search(withRequestID(), catalog.SearchQuery{Query: "süt"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	want := map[string]int32{
		a101Market + "/CIKOLATA-80": 5, a101Market + "/SUT-1L": 0,
		testMarket + "/CIKOLATA-80": 9, testMarket + "/SUT-1L": 24,
	}
	if got := stockOf(list); !reflect.DeepEqual(got, want) {
		t.Errorf("adetler: %v, beklenen %v", got, want)
	}
	asked := map[string][]string{
		a101Market: {"CIKOLATA-80", "SUT-1L"},
		testMarket: {"CIKOLATA-80", "SUT-1L"},
	}
	if got := stock.askedMarkets(); !reflect.DeepEqual(got, asked) {
		t.Errorf("stok market basina bir kez, yalnizca urunu olan markete sorulmali: %v", got)
	}
	// Katalogun sirasi (acik marketler yakindan uzaga, kapalilar sonda) korunur.
	if order := marketOrder(list); !reflect.DeepEqual(order, []string{a101Market, testMarket, manavMarket}) {
		t.Errorf("sira korunmali: %v", order)
	}
	if encoded := testkit.JSON(t, list); !strings.Contains(encoded, `"availableQuantity":0`) {
		t.Errorf("0 adet (tukendi) acikca yazilmali: %s", encoded)
	}
	if logs.Len() != 0 {
		t.Errorf("her sey yolundayken gunluk yazilmamali: %s", logs.String())
	}
}

func TestSearchOneMarketStockFailureOnlyAffectsThatMarket(t *testing.T) {
	// Migros'un stogu gelmedi: yalnizca Migros'un urunleri stoksuz; A101 etkilenmez.
	stock := &marketStock{
		availability: map[string]inventory.Availability{a101Market: {Quantities: map[string]int32{"SUT-1L": 3}}},
		failing:      map[string]error{testMarket: apperror.New(apperror.CodeServiceUnavailable, nil)},
	}
	var logs bytes.Buffer
	search := NewSearch(&fakeSearchCatalog{list: results(found(a101Market, "SUT-1L"), found(testMarket, "SUT-1L"))},
		stock, slog.New(slog.NewJSONHandler(&logs, nil)))

	list, err := search.Search(withRequestID(), catalog.SearchQuery{Query: "süt"})
	if err != nil {
		t.Fatalf("stok hatasi aramayi dusurmemeli: %v", err)
	}

	if want := map[string]int32{a101Market + "/SUT-1L": 3, testMarket + "/SUT-1L": -1}; !reflect.DeepEqual(stockOf(list), want) {
		t.Errorf("adetler: %v, beklenen %v", stockOf(list), want)
	}
	lines := logLines(t, &logs)
	if len(lines) != 1 || lines[0]["level"] != "WARN" || lines[0]["marketId"] != testMarket ||
		lines[0]["requestId"] != testRequestID || !strings.Contains(fmt.Sprint(lines[0]["err"]), "SERVICE_UNAVAILABLE") {
		t.Errorf("tek uyari satiri o marketle, istek kimligi ve hatayla yazilmali: %s", logs.String())
	}
}

func TestSearchUnknownSkuIsZeroAndLogged(t *testing.T) {
	stock := &marketStock{availability: map[string]inventory.Availability{
		a101Market: {Quantities: map[string]int32{"SUT-1L": 3}, Unknown: []string{"YENI-URUN"}},
	}}
	var logs bytes.Buffer
	search := NewSearch(&fakeSearchCatalog{list: results(found(a101Market, "SUT-1L", "YENI-URUN"))},
		stock, slog.New(slog.NewJSONHandler(&logs, nil)))

	list, err := search.Search(withRequestID(), catalog.SearchQuery{Query: "urun"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	if want := map[string]int32{a101Market + "/SUT-1L": 3, a101Market + "/YENI-URUN": 0}; !reflect.DeepEqual(stockOf(list), want) {
		t.Errorf("kaydi olmayan urun 0 olmali: %v", stockOf(list))
	}
	lines := logLines(t, &logs)
	if len(lines) != 1 || lines[0]["marketId"] != a101Market || !reflect.DeepEqual(lines[0]["skus"], []any{"YENI-URUN"}) {
		t.Errorf("uyari satiri market ve SKU'yu tasimali: %s", logs.String())
	}
}

func TestSearchCatalogErrorSkipsStock(t *testing.T) {
	catalogErr := apperror.New(apperror.CodeValidationFailed, map[string]string{"q": "zorunlu"})
	stock := &marketStock{}
	search := NewSearch(&fakeSearchCatalog{err: catalogErr}, stock, slog.New(slog.DiscardHandler))

	_, err := search.Search(context.Background(), catalog.SearchQuery{})

	if !errors.Is(err, catalogErr) {
		t.Errorf("katalog hatasi oldugu gibi donmeli: %v", err)
	}
	if asked := stock.askedMarkets(); len(asked) != 0 {
		t.Errorf("katalog hata verince stok sorulmamali: %v", asked)
	}
}

func TestSearchEmptyResultSkipsStock(t *testing.T) {
	stock := &marketStock{}
	search := NewSearch(&fakeSearchCatalog{list: results()}, stock, slog.New(slog.DiscardHandler))

	list, err := search.Search(context.Background(), catalog.SearchQuery{Query: "xyzq"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if asked := stock.askedMarkets(); len(asked) != 0 {
		t.Errorf("sonuc yokken stok sorulmamali: %v", asked)
	}
	if encoded := testkit.JSON(t, list); encoded != `{"items":[]}` {
		t.Errorf("bos liste [] olmali: %s", encoded)
	}
}
