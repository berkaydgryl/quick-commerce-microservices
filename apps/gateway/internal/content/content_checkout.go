package content

// Checkout, odeme sayfasinin metinleri (T17.1; referans getircarsi odeme
// sayfasi; KAMPANYA YOK): hediye bilgileri, teslimat yontemi, siparis notu ve
// "Zili Çalma", odeme yontemi, odeme ozeti, sozlesme onayi ve pencereleri,
// "Sipariş Ver". Sozlesme paragraflari bugun DEMO yer tutucu (hukuki metin
// uydurulmaz). Yalnizca metin; kural cumleleri web'in kural dosyasinda.
type Checkout struct {
	Title                   string   `json:"title"`
	GiftTitle               string   `json:"giftTitle"`
	GiftToggleLabel         string   `json:"giftToggleLabel"`
	GiftYesLabel            string   `json:"giftYesLabel"`
	GiftNoLabel             string   `json:"giftNoLabel"`
	GiftInfoLabel           string   `json:"giftInfoLabel"`
	GiftInfoText            string   `json:"giftInfoText"`
	PresetNoteLabel         string   `json:"presetNoteLabel"`
	PresetNotesTitle        string   `json:"presetNotesTitle"`
	PresetNotes             []string `json:"presetNotes"`
	GiftMessageLabel        string   `json:"giftMessageLabel"`
	SenderNameLabel         string   `json:"senderNameLabel"`
	RecipientNameLabel      string   `json:"recipientNameLabel"`
	RecipientPhoneLabel     string   `json:"recipientPhoneLabel"`
	DeliveryTitle           string   `json:"deliveryTitle"`
	DeliveryFeeLabel        string   `json:"deliveryFeeLabel"`
	FreeDeliveryLabel       string   `json:"freeDeliveryLabel"`
	NoteTitle               string   `json:"noteTitle"`
	NoteLabel               string   `json:"noteLabel"`
	NotePlaceholder         string   `json:"notePlaceholder"`
	DoNotRingLabel          string   `json:"doNotRingLabel"`
	PaymentTitle            string   `json:"paymentTitle"`
	ChangeLabel             string   `json:"changeLabel"`
	AddCardLabel            string   `json:"addCardLabel"`
	CardsLoadingLabel       string   `json:"cardsLoadingLabel"`
	NoCardNotice            string   `json:"noCardNotice"`
	SecurityNote            string   `json:"securityNote"`
	SummaryTitle            string   `json:"summaryTitle"`
	SubtotalLabel           string   `json:"subtotalLabel"`
	DeliveryFeeRowLabel     string   `json:"deliveryFeeRowLabel"`
	FreeLabel               string   `json:"freeLabel"`
	PayableLabel            string   `json:"payableLabel"`
	PreInfoLinkLabel        string   `json:"preInfoLinkLabel"`
	AgreementJoiner         string   `json:"agreementJoiner"`
	DistanceSalesLinkLabel  string   `json:"distanceSalesLinkLabel"`
	AgreementSuffix         string   `json:"agreementSuffix"`
	PreInfoParagraphs       []string `json:"preInfoParagraphs"`
	DistanceSalesParagraphs []string `json:"distanceSalesParagraphs"`
	CloseLabel              string   `json:"closeLabel"`
	PlaceOrderLabel         string   `json:"placeOrderLabel"`
	// Siparis akisi ve 3DS penceresi (T12.4).
	PlacingLabel              string `json:"placingLabel"`
	OrderPlacedToast          string `json:"orderPlacedToast"`
	OrderInReviewToast        string `json:"orderInReviewToast"`
	BlockerGiftNotice         string `json:"blockerGiftNotice"`
	BlockerAgreementNotice    string `json:"blockerAgreementNotice"`
	BlockerCardNotice         string `json:"blockerCardNotice"`
	BlockerAddressNotice      string `json:"blockerAddressNotice"`
	BlockerMinBasketNotice    string `json:"blockerMinBasketNotice"`
	BlockerClosedNotice       string `json:"blockerClosedNotice"`
	ThreeDsTitle              string `json:"threeDsTitle"`
	ThreeDsDescription        string `json:"threeDsDescription"`
	ThreeDsCodeLabel          string `json:"threeDsCodeLabel"`
	ThreeDsSubmitLabel        string `json:"threeDsSubmitLabel"`
	ThreeDsSubmittingLabel    string `json:"threeDsSubmittingLabel"`
	ThreeDsCancelLabel        string `json:"threeDsCancelLabel"`
	ThreeDsRemainingLabel     string `json:"threeDsRemainingLabel"`
	ThreeDsLastSecondsNotice  string `json:"threeDsLastSecondsNotice"`
	ThreeDsAttemptsLeftSuffix string `json:"threeDsAttemptsLeftSuffix"`
	ThreeDsExpiredToast       string `json:"threeDsExpiredToast"`
	ThreeDsCancelledToast     string `json:"threeDsCancelledToast"`
}
