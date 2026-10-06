package cards

import (
	"encoding/json"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	cardvaultv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/cardvault/v1"
)

func protoCard() *cardvaultv1.SavedCard {
	return &cardvaultv1.SavedCard{
		Id:          "crd_0123456789abcdef0123456789abcdef",
		Brand:       cardvaultv1.CardBrand_CARD_BRAND_AMEX,
		First4:      "3782",
		Last4:       "0005",
		ExpiryMonth: 12,
		ExpiryYear:  2031,
		HolderName:  "Ayşe Yılmaz",
		Nickname:    "",
		Expired:     false,
		CreatedAt:   timestamppb.New(time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)),
	}
}

func TestSavedCardIsMaskedAndOmitsEmptyNickname(t *testing.T) {
	// QA G4: proto'daki bos kart adi "yok" demektir; JSON'da alan HIC yazilmaz.
	card, err := toSavedCard(protoCard())
	if err != nil {
		t.Fatalf("cevrilemedi: %v", err)
	}
	encoded, err := json.Marshal(card)
	if err != nil {
		t.Fatalf("kodlanamadi: %v", err)
	}
	want := `{"id":"crd_0123456789abcdef0123456789abcdef","brand":"AMEX","first4":"3782","last4":"0005","expiryMonth":12,"expiryYear":2031,"holderName":"Ayşe Yılmaz","expired":false,"createdAt":"2026-10-05T12:00:00Z"}`
	if string(encoded) != want {
		t.Errorf("gorunum:\n got %s\nwant %s", encoded, want)
	}
}

func TestSavedCardKeepsNickname(t *testing.T) {
	card := protoCard()
	card.Nickname = "İş kartı"
	view, err := toSavedCard(card)
	if err != nil || view.Nickname != "İş kartı" {
		t.Fatalf("kart adi: %+v, %v", view, err)
	}
}

func TestUnknownBrandOrMissingCardIsInternal(t *testing.T) {
	unknown := protoCard()
	unknown.Brand = cardvaultv1.CardBrand_CARD_BRAND_UNSPECIFIED
	if _, err := toSavedCard(unknown); err == nil {
		t.Error("bilinmeyen marka hata vermeli: sozlesme disi cevap istemciye gitmez")
	}
	if _, err := toSavedCard(nil); err == nil {
		t.Error("bos kart hata vermeli")
	}
}

func TestEmptyListIsEncodedAsArray(t *testing.T) {
	list, err := toSavedCardList(nil)
	if err != nil {
		t.Fatalf("liste: %v", err)
	}
	encoded, err := json.Marshal(list)
	if err != nil || string(encoded) != `{"items":[]}` {
		t.Errorf("bos liste [] olmali: %s, %v", encoded, err)
	}
}
