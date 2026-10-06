package content

// AppHeader, uygulamanin ust bari (T11.10): logo | arama kutusu (icinde
// teslimat adresi) | Profil. Yalnizca metinler; kural yok.
type AppHeader struct {
	SearchLabel       string `json:"searchLabel"`
	SearchPlaceholder string `json:"searchPlaceholder"`
	SearchClearLabel  string `json:"searchClearLabel"`
	AddressLabel      string `json:"addressLabel"`
	AddressListLabel  string `json:"addressListLabel"`
	// Adreslerim penceresi: baslik, onay dugmesi, alt bant (Adres Ekle).
	AddressBookTitle    string `json:"addressBookTitle"`
	AddressConfirmLabel string `json:"addressConfirmLabel"`
	AddressAddPrompt    string `json:"addressAddPrompt"`
	AddressAddLabel     string `json:"addressAddLabel"`
	AddressLoginLabel   string `json:"addressLoginLabel"`
	NoAddressNotice     string `json:"noAddressNotice"`
	AddressLoadingLabel string `json:"addressLoadingLabel"`
	ProfileLabel        string `json:"profileLabel"`
	AccountLabel        string `json:"accountLabel"`
	LogoutLabel         string `json:"logoutLabel"`
	LogoutPendingLabel  string `json:"logoutPendingLabel"`
}
