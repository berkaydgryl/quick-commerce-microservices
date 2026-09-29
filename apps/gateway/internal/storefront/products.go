// Package storefront, musterinin gordugu urun listesini kurar: katalogun
// sayfasi + stok servisinin adetleri (T8.4, B27).
//
// NEDEN AYRI PAKET: katalog adaptoru stogu bilmez, stok adaptoru urunu bilmez.
// Ikisini birlestirme kurallari (tek cagri, kaydi olmayan SKU, stok servisi
// cevap vermezse ne olur) tek yerde durur; HTTP katmani yalnizca bu paketi gorur.
package storefront

import (
	"context"
	"log/slog"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/inventory"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rpc"
)

// ProductLister, katalogun urun sayfasi (gercegi catalog.Service).
type ProductLister interface {
	MarketProducts(ctx context.Context, query catalog.ProductQuery) (catalog.ProductPage, error)
}

// StockReader, toplu stok sorgusu (gercegi inventory.Service).
type StockReader interface {
	Availability(ctx context.Context, marketID string, skus []string) (inventory.Availability, error)
}

// Products, GET /v1/markets/{marketId}/products ucunun gateway tarafi.
type Products struct {
	catalog ProductLister
	stock   StockReader
	logger  *slog.Logger
}

// NewProducts, katalog ve stok kaynaklarini birlestirir.
func NewProducts(catalog ProductLister, stock StockReader, logger *slog.Logger) *Products {
	return &Products{catalog: catalog, stock: stock, logger: logger}
}

// MarketProducts, marketin urun sayfasi; her urunde satilabilir adet.
//
// Kurallar:
//   - TEK stok cagrisi (B27): sayfanin butun SKU'lari tek CheckAvailability'de.
//     Sayfa en fazla 100 urundur, stok sorgusunun siniri de 100.
//   - Stok servisi hata verirse ya da sure asilirsa sayfa STOKSUZ doner: alan
//     yazilmaz ("stok bilgisi yok", @getir/contracts productSchema). Katalog
//     stok yuzunden dusmez; uyari gunluge yazilir.
//   - Stok kaydi olmayan SKU 0'dir ("satilamaz"): rezervasyon da onu reddeder.
//     Katalog ile stok ayrismistir (ya da Redis bosalmistir); uyari gunluge yazilir.
func (p *Products) MarketProducts(ctx context.Context, query catalog.ProductQuery) (catalog.ProductPage, error) {
	page, err := p.catalog.MarketProducts(ctx, query)
	if err != nil {
		return catalog.ProductPage{}, err
	}
	skus := skusOf(page.Items)
	if len(skus) == 0 {
		return page, nil
	}

	availability, err := p.stock.Availability(ctx, query.MarketID, skus)
	if err != nil {
		p.logger.WarnContext(ctx, "stok okunamadi, urunler stoksuz donuyor",
			slog.String("marketId", query.MarketID),
			slog.String("requestId", rpc.RequestIDFrom(ctx)),
			slog.Any("err", err))
		return page, nil
	}

	if missing := applyStock(page.Items, availability); len(missing) > 0 {
		p.logger.WarnContext(ctx, "stok kaydi olmayan urunler 0 gosteriliyor",
			slog.String("marketId", query.MarketID),
			slog.String("requestId", rpc.RequestIDFrom(ctx)),
			slog.Any("skus", missing))
	}
	return page, nil
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
