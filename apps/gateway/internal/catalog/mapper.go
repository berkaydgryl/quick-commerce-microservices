package catalog

import catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"

// Category, REST sozlesmesindeki kategori (@getir/contracts categorySchema).
//
// Alan adlari proto'nun camelCase karsiligidir; gateway alan adi cevirmekten
// baska donusum yapmaz (contracts/common.ts).
type Category struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
	// Sozlesmede istege bagli. proto3'te "yok" ile "bos metin" ayni degerdir;
	// bos metin disari "imageUrl": "" olarak cikarsa istemcideki url()
	// dogrulamasi dusurur. Bu yuzden bos ise alan HIC yazilmaz.
	ImageURL  string `json:"imageUrl,omitempty"`
	SortOrder int32  `json:"sortOrder"`
}

// CategoryList, GET /v1/categories cevabinin data alani (categoryListSchema).
type CategoryList struct {
	Items []Category `json:"items"`
}

func toCategoryList(categories []*catalogv1.Category) CategoryList {
	// Bos liste JSON'da [] olmali, null DEGIL: sozlesme items'i dizi olarak
	// zorunlu tutar. nil dilim "null" diye kodlanirdi.
	items := make([]Category, 0, len(categories))
	for _, category := range categories {
		items = append(items, toCategory(category))
	}
	return CategoryList{Items: items}
}

func toCategory(category *catalogv1.Category) Category {
	return Category{
		ID:        category.GetId(),
		Name:      category.GetName(),
		Slug:      category.GetSlug(),
		ImageURL:  category.GetImageUrl(),
		SortOrder: category.GetSortOrder(),
	}
}
