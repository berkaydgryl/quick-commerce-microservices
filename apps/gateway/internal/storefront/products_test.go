package storefront

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"reflect"
	"strings"
	"testing"

	"google.golang.org/grpc/metadata"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/inventory"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rpc"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

const (
	testMarket    = "mkt_migros-jet-moda"
	testRequestID = "req_0123456789abcdef0123456789abcdef"
)

// fakeCatalog, katalogun urun sayfasi ya da hatasi.
type fakeCatalog struct {
	page catalog.ProductPage
	err  error
}

func (f *fakeCatalog) MarketProducts(context.Context, catalog.ProductQuery) (catalog.ProductPage, error) {
	return f.page, f.err
}

// fakeStock, stok sorgusu; kac kez ve ne soruldugunu kaydeder.
type fakeStock struct {
	availability inventory.Availability
	err          error
	calls        int
	gotMarket    string
	gotSkus      []string
}

func (f *fakeStock) Availability(_ context.Context, marketID string, skus []string) (inventory.Availability, error) {
	f.calls++
	f.gotMarket = marketID
	f.gotSkus = skus
	return f.availability, f.err
}

func products(skus ...string) catalog.ProductPage {
	items := make([]catalog.Product, 0, len(skus))
	for _, sku := range skus {
		items = append(items, catalog.Product{OfferID: "ofr_" + strings.ToLower(sku), MarketID: testMarket, SKU: sku, IsActive: true})
	}
	return catalog.ProductPage{Items: items, Page: catalog.Page{NextPageToken: "sonraki"}}
}

// quantities, sayfadaki her urunun adedi; stok bilgisi yoksa -1.
func quantities(page catalog.ProductPage) map[string]int32 {
	got := make(map[string]int32, len(page.Items))
	for _, item := range page.Items {
		if item.AvailableQuantity == nil {
			got[item.SKU] = -1
			continue
		}
		got[item.SKU] = *item.AvailableQuantity
	}
	return got
}

// logLines, JSON gunluk satirlarini cozer.
func logLines(t *testing.T, logs *bytes.Buffer) []map[string]any {
	t.Helper()
	var lines []map[string]any
	for _, raw := range strings.Split(strings.TrimSpace(logs.String()), "\n") {
		if raw == "" {
			continue
		}
		var line map[string]any
		if err := json.Unmarshal([]byte(raw), &line); err != nil {
			t.Fatalf("gunluk satiri JSON degil: %q", raw)
		}
		lines = append(lines, line)
	}
	return lines
}

func withRequestID() context.Context {
	return metadata.NewOutgoingContext(context.Background(), metadata.Pairs(rpc.RequestIDKey, testRequestID))
}

func TestMarketProductsWritesStockOfEveryProduct(t *testing.T) {
	stock := &fakeStock{availability: inventory.Availability{Quantities: map[string]int32{"SUT-1L": 24, "KOLA-1L": 0, "PEYNIR-500": 2}}}
	var logs bytes.Buffer
	lister := NewProducts(&fakeCatalog{page: products("SUT-1L", "KOLA-1L", "PEYNIR-500")}, stock, slog.New(slog.NewJSONHandler(&logs, nil)))

	page, err := lister.MarketProducts(withRequestID(), catalog.ProductQuery{MarketID: testMarket})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	if want := map[string]int32{"SUT-1L": 24, "KOLA-1L": 0, "PEYNIR-500": 2}; !reflect.DeepEqual(quantities(page), want) {
		t.Errorf("adetler: %v, beklenen %v", quantities(page), want)
	}
	// 0 "tukendi"dir ve ACIKCA yazilir; yazilmasaydi istemci "stok bilgisi yok" sanardi.
	if encoded := testkit.JSON(t, page); !strings.Contains(encoded, `"availableQuantity":0`) {
		t.Errorf("0 adet yazilmali: %s", encoded)
	}
	if page.Page.NextPageToken != "sonraki" {
		t.Errorf("sayfalama korunmali: %+v", page.Page)
	}
	if stock.gotMarket != testMarket || !reflect.DeepEqual(stock.gotSkus, []string{"SUT-1L", "KOLA-1L", "PEYNIR-500"}) {
		t.Errorf("stok sorusu: market %q, SKU'lar %v", stock.gotMarket, stock.gotSkus)
	}
	if logs.Len() != 0 {
		t.Errorf("her sey yolundayken gunluk yazilmamali: %s", logs.String())
	}
}

func TestMarketProductsUnknownSkuIsZeroAndLogged(t *testing.T) {
	// Stok kaydi olmayan urun "satilamaz" (0): rezervasyon da onu reddeder.
	stock := &fakeStock{availability: inventory.Availability{
		Quantities: map[string]int32{"SUT-1L": 24},
		Unknown:    []string{"YENI-URUN"},
	}}
	var logs bytes.Buffer
	lister := NewProducts(&fakeCatalog{page: products("SUT-1L", "YENI-URUN")}, stock, slog.New(slog.NewJSONHandler(&logs, nil)))

	page, err := lister.MarketProducts(withRequestID(), catalog.ProductQuery{MarketID: testMarket})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	if want := map[string]int32{"SUT-1L": 24, "YENI-URUN": 0}; !reflect.DeepEqual(quantities(page), want) {
		t.Errorf("kaydi olmayan urun 0 olmali: %v", quantities(page))
	}
	lines := logLines(t, &logs)
	if len(lines) != 1 {
		t.Fatalf("tek uyari satiri bekleniyordu: %s", logs.String())
	}
	line := lines[0]
	if line["level"] != "WARN" || line["marketId"] != testMarket || line["requestId"] != testRequestID ||
		!reflect.DeepEqual(line["skus"], []any{"YENI-URUN"}) {
		t.Errorf("uyari satiri market, istek kimligi ve SKU'yu tasimali: %v", line)
	}
}

func TestMarketProductsWithoutStockWhenStockFails(t *testing.T) {
	// Stok servisi kapali ya da sure asildi: liste YINE doner, stok alani
	// yazilmaz ("stok bilgisi yok"). Katalog stok yuzunden dusmez.
	stock := &fakeStock{err: apperror.New(apperror.CodeServiceUnavailable, nil)}
	var logs bytes.Buffer
	lister := NewProducts(&fakeCatalog{page: products("SUT-1L", "KOLA-1L")}, stock, slog.New(slog.NewJSONHandler(&logs, nil)))

	page, err := lister.MarketProducts(withRequestID(), catalog.ProductQuery{MarketID: testMarket})
	if err != nil {
		t.Fatalf("stok hatasi listeyi dusurmemeli: %v", err)
	}

	if len(page.Items) != 2 {
		t.Fatalf("urunler donmeli: %+v", page)
	}
	if encoded := testkit.JSON(t, page); strings.Contains(encoded, "availableQuantity") {
		t.Errorf("stok gelmediyse alan yazilmamali: %s", encoded)
	}
	lines := logLines(t, &logs)
	if len(lines) != 1 || lines[0]["level"] != "WARN" || lines[0]["requestId"] != testRequestID ||
		!strings.Contains(fmt.Sprint(lines[0]["err"]), "SERVICE_UNAVAILABLE") {
		t.Errorf("uyari satiri istek kimligi ve hatayla yazilmali: %s", logs.String())
	}
}

func TestMarketProductsCatalogErrorSkipsStock(t *testing.T) {
	catalogErr := apperror.New(apperror.CodeNotFound, nil)
	stock := &fakeStock{}
	lister := NewProducts(&fakeCatalog{err: catalogErr}, stock, slog.New(slog.DiscardHandler))

	_, err := lister.MarketProducts(context.Background(), catalog.ProductQuery{MarketID: testMarket})

	if !errors.Is(err, catalogErr) {
		t.Errorf("katalog hatasi oldugu gibi donmeli: %v", err)
	}
	if stock.calls != 0 {
		t.Errorf("katalog hata verince stok sorulmamali (%d cagri)", stock.calls)
	}
}

func TestMarketProductsEmptyPageSkipsStock(t *testing.T) {
	stock := &fakeStock{}
	lister := NewProducts(&fakeCatalog{page: products()}, stock, slog.New(slog.DiscardHandler))

	page, err := lister.MarketProducts(context.Background(), catalog.ProductQuery{MarketID: testMarket})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if stock.calls != 0 || page.Items == nil {
		t.Errorf("bos sayfada stok sorulmamali (%d cagri), liste bos dizi kalmali: %+v", stock.calls, page)
	}
}

func TestMarketProductsBlankSkuIsNotAsked(t *testing.T) {
	// Stok servisi bos SKU'lu istegi butunuyle reddeder: tek bozuk teklif
	// butun sayfayi stoksuz birakmamali. O urunun stok bilgisi yoktur.
	stock := &fakeStock{availability: inventory.Availability{Quantities: map[string]int32{"SUT-1L": 24}}}
	lister := NewProducts(&fakeCatalog{page: products("SUT-1L", "")}, stock, slog.New(slog.DiscardHandler))

	page, err := lister.MarketProducts(context.Background(), catalog.ProductQuery{MarketID: testMarket})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if !reflect.DeepEqual(stock.gotSkus, []string{"SUT-1L"}) {
		t.Errorf("bos SKU sorulmamali: %v", stock.gotSkus)
	}
	if want := map[string]int32{"SUT-1L": 24, "": -1}; !reflect.DeepEqual(quantities(page), want) {
		t.Errorf("SKU'su bos urunun stok bilgisi olmamali: %v", quantities(page))
	}
}
