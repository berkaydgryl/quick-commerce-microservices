// Package cards, kart kasasi uclarinin (T11.17, GET/POST /v1/me/cards, DELETE
// ve PATCH (#148, kart adi) /v1/me/cards/{cardId}) gateway tarafidir. Kasa payment'tadir
// (getir/cardvault/v1); gateway istegi iletir, kart numarasini ve CVV'yi
// saklamaz, gunluge yazmaz.
//
// Kurallarin kaynagi @getir/contracts constants.ts'tir; buradaki kopya
// contract_test ile esitlenir.
package cards

const (
	// MaxCards, kullanici basina en fazla kayitli kart (SAVED_CARDS_MAX).
	MaxCards = 10
	// NumberMinDigits ve NumberMaxDigits, kart numarasinin hane sayisi
	// (CARD_NUMBER_MIN_DIGITS, CARD_NUMBER_MAX_DIGITS).
	NumberMinDigits = 13
	NumberMaxDigits = 19
	// HolderNameMinLength ve HolderNameMaxLength, kart uzerindeki adin uzunlugu
	// (CARD_HOLDER_NAME_MIN_LENGTH, CARD_HOLDER_NAME_MAX_LENGTH).
	HolderNameMinLength = 2
	HolderNameMaxLength = 26
	// NicknameMaxLength, kullanicinin karta verdigi adin uzunlugu
	// (CARD_NICKNAME_MAX_LENGTH).
	NicknameMaxLength = 30
)
