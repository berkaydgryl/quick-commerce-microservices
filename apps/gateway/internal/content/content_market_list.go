package content

// MarketList, market listesi ekrani (T11.12; referans getircarsi): solda
// gruplu dukkan turleri, ortada market kartlari, sagda Sepetim. Hangi turun
// hangi grupta oldugu buradan gelir; kural validate.go'dadir. Para ve sure
// bicimi istemcidedir: burada yalnizca etiketler.
type MarketList struct {
	CategoriesTitle            string           `json:"categoriesTitle"`
	AllLabel                   string           `json:"allLabel"`
	CountLabel                 string           `json:"countLabel"`
	ClearFilterLabel           string           `json:"clearFilterLabel"`
	LoadingLabel               string           `json:"loadingLabel"`
	EmptyNotice                string           `json:"emptyNotice"`
	FilterEmptyNotice          string           `json:"filterEmptyNotice"`
	RatingLabel                string           `json:"ratingLabel"`
	RatingCountLabel           string           `json:"ratingCountLabel"`
	MinBasketLabel             string           `json:"minBasketLabel"`
	FreeDeliveryThresholdLabel string           `json:"freeDeliveryThresholdLabel"`
	ClosedLabel                string           `json:"closedLabel"`
	StoreTypes                 []StoreTypeLabel `json:"storeTypes"`
	Groups                     []StoreTypeGroup `json:"groups"`
	Cart                       MarketListCart   `json:"cart"`
}

// StoreTypeLabel, dukkan turunun adi: sozlesmedeki tur ("KASAP") ve etiket.
type StoreTypeLabel struct {
	Type  string `json:"type"`
	Label string `json:"label"`
}

// StoreTypeGroup, sol menunun akordeon grubu: ad, satirdaki kucuk gorsel
// (dosyada GORELI yol, cevapta mutlak adres) ve gruptaki turler.
type StoreTypeGroup struct {
	Label    string   `json:"label"`
	ImageURL string   `json:"imageUrl"`
	Types    []string `json:"types"`
}

// MarketListCart, Sepetim paneli ve telefondaki sepet cubugu.
type MarketListCart struct {
	Title                   string `json:"title"`
	EmptyTitle              string `json:"emptyTitle"`
	EmptyHint               string `json:"emptyHint"`
	ItemCountLabel          string `json:"itemCountLabel"`
	SubtotalLabel           string `json:"subtotalLabel"`
	DeliveryLabel           string `json:"deliveryLabel"`
	FreeDeliveryLabel       string `json:"freeDeliveryLabel"`
	TotalLabel              string `json:"totalLabel"`
	MinBasketRemainingLabel string `json:"minBasketRemainingLabel"`
	// ClosedNotice, kapali marketin sebep satiri (07.10): "+" pasif, sepette not.
	ClosedNotice  string `json:"closedNotice"`
	GoToCartLabel string `json:"goToCartLabel"`
	ClearLabel    string `json:"clearLabel"`
	// ClearConfirmQuestion, Sepeti bosaltma onayi (T16.3): soru, alt not ve dugmeler; pencerenin basligi clearLabel.
	ClearConfirmQuestion string `json:"clearConfirmQuestion"`
	ClearConfirmHint     string `json:"clearConfirmHint"`
	ClearConfirmLabel    string `json:"clearConfirmLabel"`
	CancelLabel          string `json:"cancelLabel"`
	CloseLabel           string `json:"closeLabel"`
	// DecreaseSuffix, Adet dugmelerinin adi, urun adinin arkasina: "Saksıda Küçük Ağaç adedini azalt" (T16.3).
	DecreaseSuffix string `json:"decreaseSuffix"`
	IncreaseSuffix string `json:"increaseSuffix"`
	RemoveSuffix   string `json:"removeSuffix"`
	QuantitySuffix string `json:"quantitySuffix"`
}
