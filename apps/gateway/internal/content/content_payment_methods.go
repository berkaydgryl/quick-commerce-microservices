package content

// PaymentMethods, Odeme Yontemlerim'in metinleri (T11.17;
// /hesabim/odeme-yontemlerim): kayitli kartlar, "Kart ekle" sayfasi (tasarim B)
// ve silme onayi. Kural cumleleri burada degil, sozlesmede
// (CARD_FIELD_MESSAGES; kasa ayni cumleleri doner). Yalnizca metin.
type PaymentMethods struct {
	Title                 string          `json:"title"`
	LoadingLabel          string          `json:"loadingLabel"`
	EmptyNotice           string          `json:"emptyNotice"`
	AddLabel              string          `json:"addLabel"`
	ExpiredLabel          string          `json:"expiredLabel"`
	DeleteSuffix          string          `json:"deleteSuffix"`
	ConfirmTitle          string          `json:"confirmTitle"`
	ConfirmQuestionSuffix string          `json:"confirmQuestionSuffix"`
	ConfirmHint           string          `json:"confirmHint"`
	ConfirmLabel          string          `json:"confirmLabel"`
	DeletingLabel         string          `json:"deletingLabel"`
	CancelLabel           string          `json:"cancelLabel"`
	DeletedToastSuffix    string          `json:"deletedToastSuffix"`
	AddTitle              string          `json:"addTitle"`
	BrandsLabel           string          `json:"brandsLabel"`
	NumberLabel           string          `json:"numberLabel"`
	NumberValidLabel      string          `json:"numberValidLabel"`
	HolderNameLabel       string          `json:"holderNameLabel"`
	ExpiryLabel           string          `json:"expiryLabel"`
	ExpiryFormatNotice    string          `json:"expiryFormatNotice"`
	CVVLabel              string          `json:"cvvLabel"`
	NicknameLabel         string          `json:"nicknameLabel"`
	SaveLabel             string          `json:"saveLabel"`
	SavingLabel           string          `json:"savingLabel"`
	RetryWaitLabel        string          `json:"retryWaitLabel"`
	AddedToastPrefix      string          `json:"addedToastPrefix"`
	PrivacyNote           string          `json:"privacyNote"`
	HolderCaption         string          `json:"holderCaption"`
	ExpiryCaption         string          `json:"expiryCaption"`
	HolderPlaceholder     string          `json:"holderPlaceholder"`
	ExpiryPlaceholder     string          `json:"expiryPlaceholder"`
	NicknamePlaceholder   string          `json:"nicknamePlaceholder"`
	CVVCaption            string          `json:"cvvCaption"`
	CVVNote               string          `json:"cvvNote"`
	BrandLabels           CardBrandLabels `json:"brandLabels"`
	// BrandMarks, kartin ustundeki soluk buyuk marka isareti (kisa: "MC").
	BrandMarks CardBrandLabels `json:"brandMarks"`
}

// CardBrandLabels, kart markalarinin gorunen adlari; anahtarlar sozlesmedeki
// marka (proto CardBrand).
type CardBrandLabels struct {
	Visa       string `json:"VISA"`
	Mastercard string `json:"MASTERCARD"`
	Amex       string `json:"AMEX"`
	Troy       string `json:"TROY"`
}
