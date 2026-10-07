package order

import "regexp"

// Kart secimi (T12.4; @getir/contracts order.ts orderPaymentInputSchema):
// kasadaki kayitli kart (cardId, cardIdSchema) ya da DEPRECATED test jetonu
// (cardToken, kirpilmis ve bos olamaz); GONDERILEN alanlardan TAM biri.
// Cumleler ve kimlik bicimi sozlesmeyle ayni (details_contract_test.go).
//
// Sira zod'unki: once alanlarin bicimi, ancak ikisi de gecerliyse "tam biri"
// kurali (refine); boylece istemci once yanlis alani duzeltir.
const (
	// cardIDPattern, kart kimligi: ID_PREFIX.CARD + 32 hex (cardIdSchema).
	cardIDPattern     = `^crd_[0-9a-f]{32}$`
	cardIDReason      = "kart kimligi bekleniyor"
	paymentCardReason = "Ödeme için bir kart seç"
	// cardTokenReason: sozlesmede min(1) (zod'un kendi cumlesi; web gondermez).
	cardTokenReason = "zorunlu"
)

var cardIDRegexp = regexp.MustCompile(cardIDPattern)

// Alan adlari: odeme nesnesine goreli (REST'te "payment." onekiyle).
const (
	fieldCardID    = "cardId"
	fieldCardToken = "cardToken"
)

// CardChoice, istekteki kart kaynagi; nil alan gonderilmedi demektir.
type CardChoice struct {
	ID    *string
	Token *string
}

// Normalized, jetonu kirpilmis KOPYA (contracts .trim()); kart kimligi kirpilmaz.
func (c CardChoice) Normalized() CardChoice {
	if c.Token != nil {
		token := trimJS(*c.Token)
		c.Token = &token
	}
	return c
}

// Problems, kurala uymayan alanlar -> sebep (odeme nesnesine goreli); bossa
// secim gecerlidir. Kirpilmis (Normalized) secim uzerinde cagrilir.
func (c CardChoice) Problems() map[string]string {
	problems := map[string]string{}
	if c.ID != nil && !cardIDRegexp.MatchString(*c.ID) {
		problems[fieldCardID] = cardIDReason
	}
	if c.Token != nil && *c.Token == "" {
		problems[fieldCardToken] = cardTokenReason
	}
	if len(problems) == 0 && (c.ID == nil) == (c.Token == nil) {
		problems[fieldCardID] = paymentCardReason
	}
	return problems
}

// Apply, gecerli secimi siparis girdisine yazar.
func (c CardChoice) Apply(input *PlaceInput) {
	if c.ID != nil {
		input.CardID = *c.ID
	}
	if c.Token != nil {
		input.CardToken = *c.Token
	}
}
