package content

// PaymentMethods, Odeme Yontemlerim'in metinleri (T11.17;
// /hesabim/odeme-yontemlerim): kayitli kartlar, "Kart ekle" sayfasi (tasarim B)
// ve silme onayi. Kural cumleleri burada degil, sozlesmede
// (CARD_FIELD_MESSAGES; kasa ayni cumleleri doner). Yalnizca metin.
type PaymentMethods struct {
	Title        string `json:"title"`
	LoadingLabel string `json:"loadingLabel"`
	// AddLabel, Listenin son satiri: kart ekle baglantisi.
	AddLabel string `json:"addLabel"`
	// ExpiredLabel, Suresi gecen kartin etiketi.
	ExpiredLabel string `json:"expiredLabel"`
	// LastFourLabel, Ekran okuyucunun kart adi: "Visa, son dört hane 4242" (maske okunmaz; QA D6).
	LastFourLabel string `json:"lastFourLabel"`
	// DeleteSuffix, Cop kutusunun adi, kartin okunan adinin arkasina: "Visa, son dört hane 4242 kartını sil".
	DeleteSuffix string `json:"deleteSuffix"`
	// ConfirmTitle, Silme onayi.
	ConfirmTitle          string `json:"confirmTitle"`
	ConfirmQuestionSuffix string `json:"confirmQuestionSuffix"`
	ConfirmHint           string `json:"confirmHint"`
	ConfirmLabel          string `json:"confirmLabel"`
	DeletingLabel         string `json:"deletingLabel"`
	CancelLabel           string `json:"cancelLabel"`
	DeletedToastSuffix    string `json:"deletedToastSuffix"`
	// CloseLabel, Pencerelerin X dugmesi (silme onayi, kosullar); icerik gelmese de yedekten (QA C5).
	CloseLabel string `json:"closeLabel"`
	// BackToListLabel, Kart ekle sayfasi (referans getircarsi "Kart Ekle").
	BackToListLabel string `json:"backToListLabel"`
	AddTitle        string `json:"addTitle"`
	// SecurityTitle, Guvenlik kutusu: kendi metnimiz (Masterpass yok).
	SecurityTitle    string `json:"securityTitle"`
	SecurityText     string `json:"securityText"`
	NicknameLabel    string `json:"nicknameLabel"`
	NumberLabel      string `json:"numberLabel"`
	NumberValidLabel string `json:"numberValidLabel"`
	HolderNameLabel  string `json:"holderNameLabel"`
	// ExpiryLegend, Son kullanma: Ay ve Yil secimleri; yillar sozlesmeden (cardExpiryYears).
	ExpiryLegend         string `json:"expiryLegend"`
	MonthLabel           string `json:"monthLabel"`
	YearLabel            string `json:"yearLabel"`
	ExpiryRequiredNotice string `json:"expiryRequiredNotice"`
	CVVLabel             string `json:"cvvLabel"`
	// TermsLinkLabel, Zorunlu onay: baglanti + arkasindaki metin; baglanti kosullar penceresini acar.
	TermsLinkLabel      string   `json:"termsLinkLabel"`
	TermsSuffix         string   `json:"termsSuffix"`
	TermsRequiredNotice string   `json:"termsRequiredNotice"`
	TermsTitle          string   `json:"termsTitle"`
	TermsParagraphs     []string `json:"termsParagraphs"`
	SaveLabel           string   `json:"saveLabel"`
	SavingLabel         string   `json:"savingLabel"`
	// RetryWaitLabel, Cok fazla basarisiz dogrulama (429): geri sayimin basi, "Yeniden deneyebilmen için 4:59".
	RetryWaitLabel string `json:"retryWaitLabel"`
	// DuplicateCardNotice, Ayni kart (CONFLICT, details.cardId; QA C4).
	DuplicateCardNotice string `json:"duplicateCardNotice"`
	// AddedToastPrefix, Basarida bildirimin basi: "Kart eklendi:" + " Visa •••• 4242".
	AddedToastPrefix string `json:"addedToastPrefix"`
	// AcceptedBrandsLabel, Formun altindaki marka logolarinin erisilebilir adi.
	AcceptedBrandsLabel string `json:"acceptedBrandsLabel"`
	// HolderCaption, Kartin yuzu (tasarim B): basliklar, bos alan yer tutuculari, arka yuz notu.
	HolderCaption       string `json:"holderCaption"`
	ExpiryCaption       string `json:"expiryCaption"`
	HolderPlaceholder   string `json:"holderPlaceholder"`
	ExpiryPlaceholder   string `json:"expiryPlaceholder"`
	NicknamePlaceholder string `json:"nicknamePlaceholder"`
	CVVCaption          string `json:"cvvCaption"`
	CVVNote             string `json:"cvvNote"`
	// BrandLabels, Marka adlari ve soluk kisa isaret.
	BrandLabels CardBrandLabels `json:"brandLabels"`
	BrandMarks  CardBrandLabels `json:"brandMarks"`
}

// CardBrandLabels, kart markalarinin gorunen adlari; anahtarlar sozlesmedeki
// marka (proto CardBrand).
type CardBrandLabels struct {
	Visa       string `json:"VISA"`
	Mastercard string `json:"MASTERCARD"`
	Amex       string `json:"AMEX"`
	Troy       string `json:"TROY"`
}
