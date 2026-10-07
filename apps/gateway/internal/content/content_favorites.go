package content

// Favorites, favori marketlerin metinleri (T11.13; referans getircarsi
// "Favori Isletmelerim"): kalbin erisilebilir adlari, favori sayfasi ve hata
// bildirimleri. Yalnizca metin; kural yok.
type Favorites struct {
	Title             string `json:"title"`
	AddLabel          string `json:"addLabel"`
	RemoveLabel       string `json:"removeLabel"`
	LoadingLabel      string `json:"loadingLabel"`
	EmptyTitle        string `json:"emptyTitle"`
	EmptyHint         string `json:"emptyHint"`
	RemovedNotice     string `json:"removedNotice"`
	UpdateFailedToast string `json:"updateFailedToast"`
	ListFullToast     string `json:"listFullToast"`
	ToastDismissLabel string `json:"toastDismissLabel"`
}
