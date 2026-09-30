package storefront

import (
	"context"
	"log/slog"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/inventory"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rpc"
)

// StockReader, toplu stok sorgusu (gercegi inventory.Service).
type StockReader interface {
	Availability(ctx context.Context, marketID string, skus []string) (inventory.Availability, error)
}

// stockWriter, BIR marketin urunlerine stok servisinin adetlerini yazar. Urun
// listesi (T8.4) ve genel arama (T9.6) ayni kurallari kullanir:
//   - TEK stok cagrisi: urunlerin butun SKU'lari tek CheckAvailability'de (B27).
//   - Stok servisi hata verirse ya da sure asilirsa urunler STOKSUZ kalir: alan
//     yazilmaz ("stok bilgisi yok", @getir/contracts productSchema). Katalog
//     stok yuzunden dusmez; uyari gunluge yazilir.
//   - Stok kaydi olmayan SKU 0'dir ("satilamaz"): rezervasyon da onu reddeder.
//     Katalog ile stok ayrismistir (ya da Redis bosalmistir); uyari gunluge yazilir.
type stockWriter struct {
	stock  StockReader
	logger *slog.Logger
}

// write, adetleri yerinde yazar; hata dondurmez (stok gelmezse urunler
// stoksuz kalir, sozlesme bunu tanimlar). Sorulacak SKU yoksa cagri yapilmaz.
func (w stockWriter) write(ctx context.Context, marketID string, items []catalog.Product) {
	skus := skusOf(items)
	if len(skus) == 0 {
		return
	}

	availability, err := w.stock.Availability(ctx, marketID, skus)
	if err != nil {
		w.logger.WarnContext(ctx, "stok okunamadi, urunler stoksuz donuyor",
			slog.String("marketId", marketID),
			slog.String("requestId", rpc.RequestIDFrom(ctx)),
			slog.Any("err", err))
		return
	}

	if missing := applyStock(items, availability); len(missing) > 0 {
		w.logger.WarnContext(ctx, "stok kaydi olmayan urunler 0 gosteriliyor",
			slog.String("marketId", marketID),
			slog.String("requestId", rpc.RequestIDFrom(ctx)),
			slog.Any("skus", missing))
	}
}

// skusOf, sorulacak SKU'lar. Bos SKU sorulmaz: stok servisi bos SKU'lu istegi
// butunuyle reddeder, tek bozuk teklif butun sayfayi stoksuz birakmamali.
func skusOf(items []catalog.Product) []string {
	skus := make([]string, 0, len(items))
	for _, item := range items {
		if item.SKU != "" {
			skus = append(skus, item.SKU)
		}
	}
	return skus
}

// applyStock, adetleri urunlere yazar; adedi 0 yazilan (stok kaydi olmayan)
// SKU'lari dondurur. Sorulmayan (SKU'su bos) urunun alani yazilmaz.
func applyStock(items []catalog.Product, availability inventory.Availability) []string {
	var missing []string
	for i := range items {
		if items[i].SKU == "" {
			continue
		}
		quantity, known := availability.Quantities[items[i].SKU]
		if !known {
			missing = append(missing, items[i].SKU)
		}
		items[i].AvailableQuantity = &quantity
	}
	return missing
}
