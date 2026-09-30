package storefront

import (
	"context"
	"log/slog"
	"sync"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
)

// SearchLister, katalogun genel aramasi (gercegi catalog.Service).
type SearchLister interface {
	Search(ctx context.Context, query catalog.SearchQuery) (catalog.SearchResultList, error)
}

// Search, GET /v1/search ucunun gateway tarafi (T9.6).
type Search struct {
	catalog SearchLister
	stock   stockWriter
}

// NewSearch, katalogun genel aramasini ve stok kaynagini birlestirir.
func NewSearch(catalog SearchLister, stock StockReader, logger *slog.Logger) *Search {
	return &Search{catalog: catalog, stock: stockWriter{stock: stock, logger: logger}}
}

// Search, genel arama; her urunde satilabilir adet.
//
// Kurallar urun listesiyle ayni (stockWriter), tek farkla: sonuc BIRDEN COK
// markettir ve stok MARKET BASINA sorulur.
//   - NEDEN MARKET BASINA: stok sayaclari market bazinda tutulur (Redis
//     anahtarinda {market} hash-tag'i); cok marketi tek okumada okuyan bir
//     sorgu yok, stok servisi de market basina ayri okurdu.
//   - Cagrilar PARALEL: sure tek cagrininki kadar; her birinin kendi siniri
//     var (GATEWAY_STOCK_TIMEOUT_MS). Market sayisi sinirlidir (katalog en
//     fazla 20 market, market basina en fazla 3 urun dondurur).
//   - Bir marketin stogu gelmezse YALNIZCA o marketin urunleri stoksuz doner;
//     digerleri etkilenmez. Urunu olmayan (yalnizca adi eslesen) market icin
//     stok sorulmaz.
func (s *Search) Search(ctx context.Context, query catalog.SearchQuery) (catalog.SearchResultList, error) {
	list, err := s.catalog.Search(ctx, query)
	if err != nil {
		return catalog.SearchResultList{}, err
	}

	// Her gorutin YALNIZCA kendi marketinin urun dilimine yazar; paylasilan
	// veri yok. Wait, butun cagrilar bitmeden donmez (sizinti yok): her cagri
	// kendi suresiyle sinirli.
	var wg sync.WaitGroup
	for i := range list.Items {
		result := &list.Items[i]
		wg.Go(func() {
			s.stock.write(ctx, result.Market.ID, result.Products)
		})
	}
	wg.Wait()
	return list, nil
}
