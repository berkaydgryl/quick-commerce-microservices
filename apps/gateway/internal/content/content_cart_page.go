package content

// CartPage, sepet sayfasinin metinleri (T16.3; referans getircarsi sepet
// sayfasi): baslik ve "Sepeti temizle", adres karti, "Sepet Toplamı" karti,
// "Ödemeye Geç", ust bardaki teslim suresi cipi ve bos sepetin baglantisi.
// Onay penceresi, adet kutusu ve minimum sepet metinleri sepet paneliyle
// ortaktir (MarketList.Cart). Yalnizca metin; kural yok.
type CartPage struct {
	Title               string `json:"title"`
	ClearLabel          string `json:"clearLabel"`
	AddressTitle        string `json:"addressTitle"`
	AddressLoadingLabel string `json:"addressLoadingLabel"`
	// NoAddressNotice, kayitli adresi olmayan kullaniciya.
	NoAddressNotice            string `json:"noAddressNotice"`
	TotalsTitle                string `json:"totalsTitle"`
	SubtotalLabel              string `json:"subtotalLabel"`
	FreeDeliveryRemainingLabel string `json:"freeDeliveryRemainingLabel"`
	CheckoutLabel              string `json:"checkoutLabel"`
	// DeliveryTimeShortLabel ("TVS") ve DeliveryTimeLabel, ust bardaki teslim suresi cipi.
	DeliveryTimeShortLabel string `json:"deliveryTimeShortLabel"`
	DeliveryTimeLabel      string `json:"deliveryTimeLabel"`
	BrowseMarketsLabel     string `json:"browseMarketsLabel"`
}

// Footer, sayfa alt bilgisi (T16.3; sepet ve odeme sayfalari): telif satiri.
// Sosyal ikonlar ve bilgi baglantisi gercek adresler verilene kadar yok.
type Footer struct {
	Copyright string `json:"copyright"`
}
