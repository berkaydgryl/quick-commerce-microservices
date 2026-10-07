package order

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf16"

	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"
)

// Siparis ayrintilari (T12.4; @getir/contracts checkout-rules.ts): hediye,
// kuryeye not, "Zili Çalma" ve sozlesme onayi. Sinirlar ve cumleler sozlesmeyle
// AYNIDIR; details_contract_test.go karsilastirir: biri degisip digeri
// unutulursa test kirilir. order-service ayni kurallari yine uygular (son soz
// onundur); burasi istegi servise ve veritabanina gitmeden reddeder.
//
// Olcu sozlesmeninki: metin JavaScript trim'iyle kirpilir (zod .trim()),
// uzunluk UTF-16 birimidir (zod .max); telefon kirpilmaz.
//
// Kisisel veri (adlar, telefon, not, mesaj): sebepler sabit cumlelerdir, DEGER
// hata ayrintisina ve gunluge girmez.
const (
	// CheckoutTextMax, kuryeye not ve hediye mesaji (CHECKOUT_TEXT_MAX).
	CheckoutTextMax = 250
	// GiftNameMax, gonderici ve alici adi (GIFT_NAME_MAX).
	GiftNameMax = 60
	// giftPhonePattern, alici telefonu: E.164 cep (PHONE_PATTERN).
	giftPhonePattern = `^\+905[0-9]{9}$`
)

var giftPhoneRegexp = regexp.MustCompile(giftPhonePattern)

// Sebepler: web formu alanin altinda gosterir; sozlesmedeki cumlelerle ayni.
const (
	recipientNameReason     = "Alıcının adını yaz"
	giftNameLengthReason    = "Ad en fazla 60 karakter olabilir"
	giftMessageLengthReason = "Hediye notu en fazla 250 karakter olabilir"
	noteLengthReason        = "Not en fazla 250 karakter olabilir"
	agreementsReason        = "Siparişi vermek için sözleşmeleri onayla"
	giftPhoneReason         = "Cep telefonu numarası 5 ile başlayan 10 rakam olmalı (örnek 532 123 45 67)"
)

// Alan adlari: ayrinti nesnesine goreli (REST'te "details." onekiyle).
const (
	fieldNote               = "note"
	fieldAgreementsAccepted = "agreementsAccepted"
	fieldGiftMessage        = "gift.message"
	fieldGiftSenderName     = "gift.senderName"
	fieldGiftRecipientName  = "gift.recipientName"
	fieldGiftRecipientPhone = "gift.recipientPhone"
)

// Gift, hediye bilgileri. Yoksa siparis hediye degildir.
type Gift struct {
	Message        string
	SenderName     string
	RecipientName  string
	RecipientPhone string
}

// Details, POST /v1/orders ayrintisi (orderDetailsSchema).
type Details struct {
	Gift               *Gift
	Note               string
	DoNotRingBell      bool
	AgreementsAccepted bool
}

// Normalized, metinleri sozlesmenin olcusuyle kirpilmis KOPYA (telefon haric).
func (d Details) Normalized() Details {
	d.Note = trimJS(d.Note)
	if d.Gift != nil {
		gift := *d.Gift
		gift.Message = trimJS(gift.Message)
		gift.SenderName = trimJS(gift.SenderName)
		gift.RecipientName = trimJS(gift.RecipientName)
		d.Gift = &gift
	}
	return d
}

// Problems, kurala uymayan alanlar -> sebep (alanlar ayrintiya goreli); bossa
// ayrinti gecerlidir. Kirpilmis (Normalized) ayrinti uzerinde cagrilir.
func (d Details) Problems() map[string]string {
	problems := map[string]string{}
	if utf16Length(d.Note) > CheckoutTextMax {
		problems[fieldNote] = noteLengthReason
	}
	if !d.AgreementsAccepted {
		problems[fieldAgreementsAccepted] = agreementsReason
	}
	if d.Gift == nil {
		return problems
	}
	if utf16Length(d.Gift.Message) > CheckoutTextMax {
		problems[fieldGiftMessage] = giftMessageLengthReason
	}
	if utf16Length(d.Gift.SenderName) > GiftNameMax {
		problems[fieldGiftSenderName] = giftNameLengthReason
	}
	switch length := utf16Length(d.Gift.RecipientName); {
	case length == 0:
		problems[fieldGiftRecipientName] = recipientNameReason
	case length > GiftNameMax:
		problems[fieldGiftRecipientName] = giftNameLengthReason
	}
	if !giftPhoneRegexp.MatchString(d.Gift.RecipientPhone) {
		problems[fieldGiftRecipientPhone] = giftPhoneReason
	}
	return problems
}

// trimJS, JavaScript String.prototype.trim (zod .trim()): Go'nun bosluk
// kumesinden farki U+FEFF'i kirpmasi, U+0085'i kirpmamasidir.
func trimJS(text string) string {
	return strings.TrimFunc(text, func(r rune) bool {
		return r == '\uFEFF' || (r != '\u0085' && unicode.IsSpace(r))
	})
}

// utf16Length, metnin UTF-16 birim sayisi (JavaScript length); kopya ayirmaz.
// Gecersiz UTF-8 bayti RuneError (tek birim) sayilir.
func utf16Length(text string) int {
	length := 0
	for _, r := range text {
		if units := utf16.RuneLen(r); units > 0 {
			length += units
		} else {
			length++
		}
	}
	return length
}

// toProtoDetails, dogrulanmis ayrintiyi proto'ya cevirir. Onay ani istekte
// GONDERILMEZ: order-service sunucu saatiyle yazar.
func toProtoDetails(details Details) *orderv1.OrderDetails {
	out := &orderv1.OrderDetails{
		Note:               details.Note,
		DoNotRingBell:      details.DoNotRingBell,
		AgreementsAccepted: details.AgreementsAccepted,
	}
	if details.Gift != nil {
		out.Gift = &orderv1.GiftDetails{
			Message:        details.Gift.Message,
			SenderName:     details.Gift.SenderName,
			RecipientName:  details.Gift.RecipientName,
			RecipientPhone: details.Gift.RecipientPhone,
		}
	}
	return out
}
