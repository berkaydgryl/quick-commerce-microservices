package content

// AccountMenu, hesap menusunun metinleri (T11.16; kullanici istegi): profil
// sayfasinin sol menusu ve ust barin Profil acilir menusu AYNI maddeleri ayni
// sirayla gosterir; sira ve adresler web'de (accountMenuItems), burada
// yalnizca etiketler. T11.17'de Odeme Yontemlerim eklenir.
type AccountMenu struct {
	// Label, sol menunun erisilebilir adi.
	Label          string `json:"label"`
	ProfileLabel   string `json:"profileLabel"`
	AddressesLabel string `json:"addressesLabel"`
	FavoritesLabel string `json:"favoritesLabel"`
	OrdersLabel    string `json:"ordersLabel"`
	// PaymentMethodsLabel, "Ödeme Yöntemlerim" (T11.17).
	PaymentMethodsLabel string `json:"paymentMethodsLabel"`
}
