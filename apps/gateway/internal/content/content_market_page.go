package content

// MarketPage, magaza sayfasinin metinleri (T16.2; referans getircarsi isletme
// sayfasi): bilgi karti ve "Hakkında" penceresi, "Bu işletmede ara…", katalog
// basliklari ve bos durumlari, urun kartinin sepet dugmesi. Puan, "Min.",
// "Kapalı", ucretsiz teslimat esigi, "Kategoriler", "Tümü" ve sepet metinleri
// market listesiyle ortaktir (MarketList). Yalnizca metin; kural yok.
type MarketPage struct {
	InfoLabel    string `json:"infoLabel"`
	LoadingLabel string `json:"loadingLabel"`
	OpenLabel    string `json:"openLabel"`
	// AboutLabel, "Hakkında" baglantisi ve penceresinin basligi.
	AboutLabel string `json:"aboutLabel"`
	CloseLabel string `json:"closeLabel"`
	// BrandLabel ile FreeDeliveryThresholdLabel arasi, pencerenin satirlari.
	BrandLabel                 string `json:"brandLabel"`
	DeliveryTimeLabel          string `json:"deliveryTimeLabel"`
	MinBasketLabel             string `json:"minBasketLabel"`
	DeliveryFeeLabel           string `json:"deliveryFeeLabel"`
	FreeDeliveryThresholdLabel string `json:"freeDeliveryThresholdLabel"`
	SearchLabel                string `json:"searchLabel"`
	SearchPlaceholder          string `json:"searchPlaceholder"`
	AllProductsTitle           string `json:"allProductsTitle"`
	SearchResultsTitle         string `json:"searchResultsTitle"`
	SearchEmptyNotice          string `json:"searchEmptyNotice"`
	CategoryEmptyNotice        string `json:"categoryEmptyNotice"`
	ProductsLoadingLabel       string `json:"productsLoadingLabel"`
	MoreLabel                  string `json:"moreLabel"`
	LoadingMoreLabel           string `json:"loadingMoreLabel"`
	// AddSuffix, urun kartinin "+"si: urunun adinin arkasina eklenir.
	AddSuffix        string `json:"addSuffix"`
	SoldOutLabel     string `json:"soldOutLabel"`
	UnavailableLabel string `json:"unavailableLabel"`
	// LowStockPrefix ve LowStockSuffix, "Son 3 adet" rozeti (T16.3): sayinin iki yani.
	LowStockPrefix string `json:"lowStockPrefix"`
	LowStockSuffix string `json:"lowStockSuffix"`
}
