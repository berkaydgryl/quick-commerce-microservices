package order

import "regexp"

// Odeme secimi (T12.4; @getir/contracts order.ts orderPaymentInputSchema):
// yonteme gore ayrilir.
//   - CARD: kasadaki kayitli kart (cardId, cardIdSchema) ya da DEPRECATED test
//     jetonu (cardToken, kirpilmis ve bos olamaz); GONDERILEN alanlardan TAM biri.
//   - CASH_ON_DELIVERY: kapida odemenin turu (onDelivery: CASH ya da POS)
//     zorunlu; kart alani gonderilmez.
//
// Yonteme ait olmayan alan, GONDERILDIGI alanda "Bu ödeme yönteminde
// gönderilmez" alir. Kartta "tam biri" kurali yalnizca alanlarin hepsi gecerliyse
// bildirilir; zod bicim sorununda (min, regex) onu da ekleyebilir. Iki taraf da
// istegi reddeder; gateway once yanlis alani gosterir. Cumleler, yontemler,
// turler ve kimlik bicimi sozlesmeyle ayni (details_contract_test.go).

// Odeme yontemleri (paymentMethodSchema) ve kapida odemenin turleri
// (deliveryPaymentKindSchema).
const (
	MethodCard           = "CARD"
	MethodCashOnDelivery = "CASH_ON_DELIVERY"
	KindCash             = "CASH"
	KindPOS              = "POS"
)

const (
	// cardIDPattern, kart kimligi: ID_PREFIX.CARD + 32 hex (cardIdSchema).
	cardIDPattern     = `^crd_[0-9a-f]{32}$`
	cardIDReason      = "kart kimligi bekleniyor"
	paymentCardReason = "Ödeme için bir kart seç"
	onDeliveryReason  = "Kapıda nasıl ödeyeceğini seç"
	notAllowedReason  = "Bu ödeme yönteminde gönderilmez"
	// cardTokenReason: sozlesmede min(1) (zod'un kendi cumlesi; web gondermez).
	cardTokenReason = "zorunlu"
	// methodReason: bilinmeyen yontem (zod'un ayirici cumlesi; web gondermez).
	// Yontem sabitlerinden kurulur: liste sozlesmeyle esitlenir (parite testi).
	methodReason = MethodCard + " ya da " + MethodCashOnDelivery + " olmali"
)

var cardIDRegexp = regexp.MustCompile(cardIDPattern)

// Alan adlari: odeme nesnesine goreli (REST'te "payment." onekiyle).
const (
	fieldMethod     = "method"
	fieldCardID     = "cardId"
	fieldCardToken  = "cardToken"
	fieldOnDelivery = "onDelivery"
)

// PaymentChoice, istekteki odeme secimi; nil alan gonderilmedi demektir.
type PaymentChoice struct {
	Method     string
	CardID     *string
	CardToken  *string
	OnDelivery *string
}

// Normalized, jetonu kirpilmis KOPYA (contracts .trim()); kart kimligi ve tur kirpilmaz.
func (c PaymentChoice) Normalized() PaymentChoice {
	if c.CardToken != nil {
		token := trimJS(*c.CardToken)
		c.CardToken = &token
	}
	return c
}

// Problems, kurala uymayan alanlar -> sebep (odeme nesnesine goreli); bossa
// secim gecerlidir. Kirpilmis (Normalized) secim uzerinde cagrilir.
func (c PaymentChoice) Problems() map[string]string {
	problems := map[string]string{}
	switch c.Method {
	case MethodCard:
		c.cardProblems(problems)
	case MethodCashOnDelivery:
		if _, known := kindToProto[deref(c.OnDelivery)]; !known {
			problems[fieldOnDelivery] = onDeliveryReason
		}
		if c.CardID != nil {
			problems[fieldCardID] = notAllowedReason
		}
		if c.CardToken != nil {
			problems[fieldCardToken] = notAllowedReason
		}
	default:
		problems[fieldMethod] = methodReason
	}
	return problems
}

func (c PaymentChoice) cardProblems(problems map[string]string) {
	if c.OnDelivery != nil {
		problems[fieldOnDelivery] = notAllowedReason
	}
	if c.CardID != nil && !cardIDRegexp.MatchString(*c.CardID) {
		problems[fieldCardID] = cardIDReason
	}
	if c.CardToken != nil && *c.CardToken == "" {
		problems[fieldCardToken] = cardTokenReason
	}
	if len(problems) == 0 && (c.CardID == nil) == (c.CardToken == nil) {
		problems[fieldCardID] = paymentCardReason
	}
}

// Apply, gecerli secimi siparis girdisine yazar.
func (c PaymentChoice) Apply(input *PlaceInput) {
	input.Method = c.Method
	if c.CardID != nil {
		input.CardID = *c.CardID
	}
	if c.CardToken != nil {
		input.CardToken = *c.CardToken
	}
	if c.OnDelivery != nil {
		input.OnDelivery = *c.OnDelivery
	}
}

// deref, isaretcinin metni; nil ise bos metin (hicbir sozlukte yok).
func deref(text *string) string {
	if text == nil {
		return ""
	}
	return *text
}
