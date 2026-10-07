package httpapi

import "github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"

// POST /v1/orders ayrintisi ve kart secimi (T12.4; @getir/contracts
// createOrderRequestSchema). Kurallar ve cumleleri order paketindedir; burasi
// govdeyi cevirir, "gonderilmedi"yi (isaretci) yakalar ve hatalari REST
// adlariyla ("details.gift.recipientPhone", "payment.cardId") toplar. Sebepler
// sabit cumlelerdir: kisisel veri (ad, telefon, not) cevaba ve gunluge YANSIMAZ.

const (
	detailsField = "details"
	paymentField = "payment"
	// giftEnabledReason: sozlesmede hediye yalnizca acikken gonderilir (enabled true).
	giftEnabledReason = "true olmali"
)

// Ayrinti alanlari isaretcidir: sozlesmede zorunlu olan alanin yoklugu
// sifir degerle (bos not, zili cal) karismasin. Onay icin isaretci gerekmez:
// yoksa da false'tur ve sozlesmenin cumlesiyle reddedilir.
type detailsBody struct {
	Gift               *giftBody `json:"gift"`
	Note               *string   `json:"note"`
	DoNotRingBell      *bool     `json:"doNotRingBell"`
	AgreementsAccepted bool      `json:"agreementsAccepted"`
}

type giftBody struct {
	Enabled        bool    `json:"enabled"`
	Message        *string `json:"message"`
	SenderName     *string `json:"senderName"`
	RecipientName  string  `json:"recipientName"`
	RecipientPhone string  `json:"recipientPhone"`
}

// toDetails, ayrintiyi cevirir, kirpar ve dogrular; sorunlari errs'e yazar.
// Ayrinti ZORUNLUDUR (sozlesme onayi her sipariste).
func (b *detailsBody) toDetails(errs fieldErrors) order.Details {
	if b == nil {
		errs[detailsField] = requiredReason
		return order.Details{}
	}
	details := order.Details{
		Note:               required(b.Note, detailsField+".note", errs),
		AgreementsAccepted: b.AgreementsAccepted,
	}
	if b.DoNotRingBell == nil {
		errs[detailsField+".doNotRingBell"] = requiredReason
	} else {
		details.DoNotRingBell = *b.DoNotRingBell
	}
	if b.Gift != nil {
		details.Gift = b.Gift.toGift(errs)
	}
	details = details.Normalized()
	collectUnder(errs, detailsField, details.Problems())
	return details
}

func (b giftBody) toGift(errs fieldErrors) *order.Gift {
	const field = detailsField + ".gift"
	if !b.Enabled {
		errs[field+".enabled"] = giftEnabledReason
	}
	return &order.Gift{
		Message:        required(b.Message, field+".message", errs),
		SenderName:     required(b.SenderName, field+".senderName", errs),
		RecipientName:  b.RecipientName,
		RecipientPhone: b.RecipientPhone,
	}
}

// required, gonderilmesi zorunlu metin (bos olabilir); yoksa sebep errs'e.
func required(value *string, field string, errs fieldErrors) string {
	if value == nil {
		errs[field] = requiredReason
		return ""
	}
	return *value
}

// collectUnder, kuralin goreli alanlarini REST onekiyle errs'e ekler.
func collectUnder(errs fieldErrors, prefix string, problems map[string]string) {
	for field, reason := range problems {
		errs[prefix+"."+field] = reason
	}
}
