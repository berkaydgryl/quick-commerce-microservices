package catalog

import catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"

// Category, REST sozlesmesindeki kategori (@getir/contracts categorySchema).
//
// Alan adlari proto'nun camelCase karsiligidir. Gateway'in alan adi disinda
// yaptigi TEK donusum gorsel adresidir: veri goreli yol tasir, istemciye
// mutlak URL gider (bkz. internal/assets).
type Category struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
	// Sozlesmede istege bagli ve MUTLAK URL'dir. proto3'te "yok" ile "bos
	// metin" ayni degerdir; bos metin disari "imageUrl": "" olarak cikarsa
	// istemcideki url() dogrulamasi dusurur. Bu yuzden bos ise alan HIC yazilmaz.
	ImageURL  string `json:"imageUrl,omitempty"`
	SortOrder int32  `json:"sortOrder"`
}

// CategoryList, GET /v1/categories cevabinin data alani (categoryListSchema).
type CategoryList struct {
	Items []Category `json:"items"`
}

func toCategoryList(categories []*catalogv1.Category, images ImageResolver) CategoryList {
	// Bos liste JSON'da [] olmali, null DEGIL: sozlesme items'i dizi olarak
	// zorunlu tutar. nil dilim "null" diye kodlanirdi.
	items := make([]Category, 0, len(categories))
	for _, category := range categories {
		items = append(items, toCategory(category, images))
	}
	return CategoryList{Items: items}
}

func toCategory(category *catalogv1.Category, images ImageResolver) Category {
	return Category{
		ID:        category.GetId(),
		Name:      category.GetName(),
		Slug:      category.GetSlug(),
		ImageURL:  images.Resolve(category.GetImageUrl()),
		SortOrder: category.GetSortOrder(),
	}
}
