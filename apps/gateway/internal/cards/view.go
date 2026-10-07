package cards

import (
	"fmt"

	cardvaultv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/cardvault/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

// SavedCard, kayitli kartin REST gorunumu (@getir/contracts savedCardSchema):
// MASKELI. Tam numara, CVV ve saglayici jetonu yoktur; proto'da da yoktur.
type SavedCard struct {
	ID          string `json:"id"`
	Brand       string `json:"brand"`
	First4      string `json:"first4"`
	Last4       string `json:"last4"`
	ExpiryMonth int32  `json:"expiryMonth"`
	ExpiryYear  int32  `json:"expiryYear"`
	HolderName  string `json:"holderName"`
	// Nickname, kullanicinin karta verdigi ad; proto'daki bos metin "kart adi
	// yok" demektir ve alan HIC yazilmaz (QA G4).
	Nickname  string `json:"nickname,omitempty"`
	Expired   bool   `json:"expired"`
	CreatedAt string `json:"createdAt"`
}

// SavedCardList, GET ve DELETE cevabi (savedCardListSchema). Bos liste [] yazilir.
type SavedCardList struct {
	Items []SavedCard `json:"items"`
}

// brandNames, proto markasi -> sozlesmedeki ad (cardBrandSchema).
var brandNames = map[cardvaultv1.CardBrand]string{
	cardvaultv1.CardBrand_CARD_BRAND_VISA:       "VISA",
	cardvaultv1.CardBrand_CARD_BRAND_MASTERCARD: "MASTERCARD",
	cardvaultv1.CardBrand_CARD_BRAND_AMEX:       "AMEX",
	cardvaultv1.CardBrand_CARD_BRAND_TROY:       "TROY",
}

// toSavedCard, proto karti REST gorunumune cevirir. Bilinmeyen marka ya da eksik
// kart INTERNAL: sozlesme disi cevap istemciye gitmez.
func toSavedCard(card *cardvaultv1.SavedCard) (SavedCard, error) {
	if card == nil {
		return SavedCard{}, &apperror.Error{Code: apperror.CodeInternal, Cause: fmt.Errorf("%s: kart cevabi bos", service)}
	}
	brand, known := brandNames[card.GetBrand()]
	if !known {
		return SavedCard{}, &apperror.Error{Code: apperror.CodeInternal, Cause: fmt.Errorf("%s: bilinmeyen kart markasi %v", service, card.GetBrand())}
	}
	createdAt := rest.TimeText(card.GetCreatedAt())
	return SavedCard{
		ID:          card.GetId(),
		Brand:       brand,
		First4:      card.GetFirst4(),
		Last4:       card.GetLast4(),
		ExpiryMonth: card.GetExpiryMonth(),
		ExpiryYear:  card.GetExpiryYear(),
		HolderName:  card.GetHolderName(),
		Nickname:    card.GetNickname(),
		Expired:     card.GetExpired(),
		CreatedAt:   createdAt,
	}, nil
}

func toSavedCardList(cards []*cardvaultv1.SavedCard) (SavedCardList, error) {
	items := make([]SavedCard, 0, len(cards))
	for _, card := range cards {
		item, err := toSavedCard(card)
		if err != nil {
			return SavedCardList{}, err
		}
		items = append(items, item)
	}
	return SavedCardList{Items: items}, nil
}
