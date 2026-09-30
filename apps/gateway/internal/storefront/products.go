// Package storefront, musterinin gordugu urun listelerini kurar: katalogun
// cevabi + stok servisinin adetleri. Market sayfasi (T8.4, B27) ve genel arama
// (T9.6) ayni stok kurallarini kullanir (stock.go).
//
// NEDEN AYRI PAKET: katalog adaptoru stogu bilmez, stok adaptoru urunu bilmez.
// Ikisini birlestirme kurallari (tek cagri, kaydi olmayan SKU, stok servisi
// cevap vermezse ne olur) tek yerde durur; HTTP katmani yalnizca bu paketi gorur.
package storefront

import (
	"context"
	"log/slog"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/catalog"
)

// ProductLister, katalogun urun sayfasi (gercegi catalog.Service).
type ProductLister interface {
	MarketProducts(ctx context.Context, query catalog.ProductQuery) (catalog.ProductPage, error)
}

// Products, GET /v1/markets/{marketId}/products ucunun gateway tarafi.
type Products struct {
	catalog ProductLister
	stock   stockWriter
}

// NewProducts, katalog ve stok kaynaklarini birlestirir.
func NewProducts(catalog ProductLister, stock StockReader, logger *slog.Logger) *Products {
	return &Products{catalog: catalog, stock: stockWriter{stock: stock, logger: logger}}
}

// MarketProducts, marketin urun sayfasi; her urunde satilabilir adet.
//
// Stok kurallari stockWriter'dadir: sayfanin butun SKU'lari TEK cagrida (sayfa
// en fazla 100 urun, stok sorgusunun siniri de 100); stok gelmezse sayfa
// stoksuz doner, stok kaydi olmayan urun 0'dir.
func (p *Products) MarketProducts(ctx context.Context, query catalog.ProductQuery) (catalog.ProductPage, error) {
	page, err := p.catalog.MarketProducts(ctx, query)
	if err != nil {
		return catalog.ProductPage{}, err
	}
	p.stock.write(ctx, query.MarketID, page.Items)
	return page, nil
}
