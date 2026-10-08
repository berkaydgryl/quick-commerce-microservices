package content

// OrderConfirmation, siparis onay ekraninin metinleri (F17; /siparis/:id/onay):
// siparis verildiyse ve risk incelemesindeyse baslik, incelemenin notu, ozet
// ve teslimat ayrintilari basliklari, iki dugme. Siparisin kendisi
// GET /v1/orders/{id}'den.
type OrderConfirmation struct {
	PlacedTitle     string `json:"placedTitle"`
	ReviewTitle     string `json:"reviewTitle"`
	ReviewNotice    string `json:"reviewNotice"`
	SummaryTitle    string `json:"summaryTitle"`
	DetailsTitle    string `json:"detailsTitle"`
	OrdersLinkLabel string `json:"ordersLinkLabel"`
	ContinueLabel   string `json:"continueLabel"`
}
