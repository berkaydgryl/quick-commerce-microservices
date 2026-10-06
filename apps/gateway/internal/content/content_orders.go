package content

// Orders, Gecmis Siparislerim'in metinleri (T11.16; /hesabim/siparislerim):
// liste satiri, durum gruplari (Tamamlandı, Devam ediyor, İptal edildi ve
// "Ücret iade edildi"), "Teslim edilmedi" (#91), bos not, "Daha fazla göster"
// ve detay etiketleri. Yalnizca metin; durum eslemesi web'dedir.
type Orders struct {
	Title              string `json:"title"`
	LoadingLabel       string `json:"loadingLabel"`
	EmptyNotice        string `json:"emptyNotice"`
	UnknownMarketLabel string `json:"unknownMarketLabel"`
	CompletedLabel     string `json:"completedLabel"`
	InProgressLabel    string `json:"inProgressLabel"`
	CancelledLabel     string `json:"cancelledLabel"`
	RefundedLabel      string `json:"refundedLabel"`
	NotDeliveredLabel  string `json:"notDeliveredLabel"`
	MoreLabel          string `json:"moreLabel"`
	LoadingMoreLabel   string `json:"loadingMoreLabel"`
	DateLabel          string `json:"dateLabel"`
	AddressLabel       string `json:"addressLabel"`
	ItemsTitle         string `json:"itemsTitle"`
	SubtotalLabel      string `json:"subtotalLabel"`
	DeliveryFeeLabel   string `json:"deliveryFeeLabel"`
	FreeDeliveryLabel  string `json:"freeDeliveryLabel"`
	DiscountLabel      string `json:"discountLabel"`
	TotalLabel         string `json:"totalLabel"`
}
