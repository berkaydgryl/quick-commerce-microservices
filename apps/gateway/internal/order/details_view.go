package order

import (
	"fmt"

	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

// GiftView, cevaptaki hediye (giftDetailsViewSchema). `enabled` yok: alanin
// varligi hediyedir.
type GiftView struct {
	Message        string `json:"message"`
	SenderName     string `json:"senderName"`
	RecipientName  string `json:"recipientName"`
	RecipientPhone string `json:"recipientPhone"`
}

// DetailsView, siparisin ayrintilari (orderDetailsViewSchema; T12.4).
// YALNIZCA GET /v1/orders/{id}'de, siparisin SAHIBINE doner (order-service
// GetOrder sahipligi denetler). Liste ve gecmis bu alani TASIMAZ.
type DetailsView struct {
	Gift                 *GiftView `json:"gift,omitempty"`
	Note                 string    `json:"note"`
	DoNotRingBell        bool      `json:"doNotRingBell"`
	AgreementsAccepted   bool      `json:"agreementsAccepted"`
	AgreementsAcceptedAt string    `json:"agreementsAcceptedAt"`
}

// OrderDetail, GET /v1/orders/{id} cevabi (orderSchema): siparis ve ayrintisi.
// Ayri tip: liste ve sahiplik denetimi (Order) kisisel veriyi TASIYAMAZ.
type OrderDetail struct {
	Order
	Details *DetailsView `json:"details,omitempty"`
}

// toDetailsView, siparisin ayrintisini cevaba cevirir; ayrintisiz sipariste
// nil. Onay ani yoksa servis sozlesmeyi bozmustur: INTERNAL (uydurma an
// istemciye gitmez).
func toDetailsView(details *orderv1.OrderDetails) (*DetailsView, error) {
	if details == nil {
		return nil, nil
	}
	if details.GetAgreementsAcceptedAt() == nil {
		return nil, &apperror.Error{Code: apperror.CodeInternal, Cause: fmt.Errorf("order: siparis ayrintisinda onay ani yok")}
	}
	view := &DetailsView{
		Note:                 details.GetNote(),
		DoNotRingBell:        details.GetDoNotRingBell(),
		AgreementsAccepted:   details.GetAgreementsAccepted(),
		AgreementsAcceptedAt: rest.TimeText(details.GetAgreementsAcceptedAt()),
	}
	if gift := details.GetGift(); gift != nil {
		view.Gift = &GiftView{
			Message:        gift.GetMessage(),
			SenderName:     gift.GetSenderName(),
			RecipientName:  gift.GetRecipientName(),
			RecipientPhone: gift.GetRecipientPhone(),
		}
	}
	return view, nil
}
