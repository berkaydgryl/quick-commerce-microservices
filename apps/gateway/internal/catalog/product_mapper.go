package catalog

import (
	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"
	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

// unitNames, proto birimi -> sozlesmedeki metin (@getir/contracts unitSchema).
// UNSPECIFIED bilerek yok: birim bilinmiyorsa alan hic yazilmaz.
var unitNames = map[commonv1.Unit]string{
	commonv1.Unit_UNIT_PIECE:    "PIECE",
	commonv1.Unit_UNIT_KILOGRAM: "KILOGRAM",
	commonv1.Unit_UNIT_LITER:    "LITER",
	commonv1.Unit_UNIT_PACK:     "PACK",
}

// Product, REST sozlesmesindeki urun (@getir/contracts productSchema): bir
// marketin TEKLIFI. Proto'da Offer'dir; id ortak urun kimligi, offerId satis.
type Product struct {
	ID          string `json:"id"`
	OfferID     string `json:"offerId"`
	MarketID    string `json:"marketId"`
	SKU         string `json:"sku"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	CategoryID  string `json:"categoryId"`
	ImageURL    string `json:"imageUrl,omitempty"`
	Price       Money  `json:"price"`
	Unit        string `json:"unit,omitempty"`
	// IsActive, teklif satista mi (proto Offer.is_active). omitempty YOK: false
	// "satista degil" demektir, yazilmamasi "bilinmiyor" sanilirdi. Liste pasif
	// teklifi de dondurur; istemci onu sepete eklemez (T7.6).
	IsActive bool `json:"isActive"`
	// Stok bilgisi yoksa nil: alan hic yazilmaz ("stok bilgisi yok", 0 DEGIL).
	// Katalog adaptoru hep nil birakir; storefront stok servisinden doldurur
	// (T8.4, B27). Stok servisi cevap vermezse nil kalir.
	AvailableQuantity *int32 `json:"availableQuantity,omitempty"`
}

// Page, imlec tabanli sayfalama (@getir/contracts pageSchema).
type Page struct {
	// Bos ise liste bitmistir.
	NextPageToken string `json:"nextPageToken"`
	// 0 = "sayilmadi", "sonuc yok" degil.
	TotalSize int32 `json:"totalSize"`
}

// ProductPage, GET /v1/markets/{marketId}/products cevabinin data alani.
type ProductPage struct {
	Items []Product `json:"items"`
	Page  Page      `json:"page"`
}

func toProductPage(response *catalogv1.ListProductsResponse, images ImageResolver) ProductPage {
	return ProductPage{
		Items: toProducts(response.GetOffers(), images),
		Page: Page{
			NextPageToken: response.GetPage().GetNextPageToken(),
			TotalSize:     response.GetPage().GetTotalSize(),
		},
	}
}

// toProducts, teklifleri urunlere cevirir. Bos liste JSON'da [] olur, null DEGIL.
func toProducts(offers []*catalogv1.Offer, images ImageResolver) []Product {
	products := make([]Product, 0, len(offers))
	for _, offer := range offers {
		products = append(products, toProduct(offer, images))
	}
	return products
}

func toProduct(offer *catalogv1.Offer, images ImageResolver) Product {
	return Product{
		ID:          offer.GetProductId(),
		OfferID:     offer.GetId(),
		MarketID:    offer.GetMarketId(),
		SKU:         offer.GetSku(),
		Name:        offer.GetName(),
		Description: offer.GetDescription(),
		CategoryID:  offer.GetCategoryId(),
		ImageURL:    images.Resolve(offer.GetImageUrl()),
		Price:       rest.MoneyFromProto(offer.GetPrice()),
		Unit:        unitNames[offer.GetUnit()],
		IsActive:    offer.GetIsActive(),
	}
}
