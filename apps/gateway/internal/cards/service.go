package cards

import (
	"context"
	"time"

	"google.golang.org/grpc"

	cardvaultv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/cardvault/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rpc"
)

// service, gunluge giden hata metnindeki servis adi.
const service = "payment"

// RPC, uretilen kart kasasi istemcisinin BU ADAPTORE lazim olan kismi.
type RPC interface {
	AddCard(ctx context.Context, in *cardvaultv1.AddCardRequest, opts ...grpc.CallOption) (*cardvaultv1.AddCardResponse, error)
	ListCards(ctx context.Context, in *cardvaultv1.ListCardsRequest, opts ...grpc.CallOption) (*cardvaultv1.ListCardsResponse, error)
	DeleteCard(ctx context.Context, in *cardvaultv1.DeleteCardRequest, opts ...grpc.CallOption) (*cardvaultv1.DeleteCardResponse, error)
}

// Service, kart uclarinin gateway tarafi: istegi kasaya iletir, cevabi REST
// bicimine cevirir. Kart kurallari kasadadir (karar sunucuda, ayni
// @getir/contracts fonksiyonlari); gateway numarayi ve CVV'yi yalnizca iletir,
// saklamaz, gunluge yazmaz. Kasanin dogrulama ayrintisi REST adlariyla gelir
// (number, cvv, ...): ceviri gerekmez.
type Service struct {
	rpc     RPC
	timeout time.Duration
}

// New, adaptoru kurar. timeout, TEK bir gRPC cagrisinin ust siniridir.
func New(rpc RPC, timeout time.Duration) *Service {
	return &Service{rpc: rpc, timeout: timeout}
}

// AddInput, ekleme govdesi (REST alanlari). Kart adi yoksa bos metin.
type AddInput struct {
	Number      string
	ExpiryMonth int32
	ExpiryYear  int32
	CVV         string
	HolderName  string
	Nickname    string
}

// AddCard, karti dogrulatip kullanicinin kasasina ekler.
func (s *Service) AddCard(ctx context.Context, userID string, in AddInput) (SavedCard, error) {
	response, err := rpc.Invoke(ctx, s.timeout, service, "AddCard", s.rpc.AddCard, &cardvaultv1.AddCardRequest{
		UserId:      userID,
		Number:      in.Number,
		ExpiryMonth: in.ExpiryMonth,
		ExpiryYear:  in.ExpiryYear,
		Cvv:         in.CVV,
		HolderName:  in.HolderName,
		Nickname:    in.Nickname,
	})
	if err != nil {
		return SavedCard{}, err
	}
	return toSavedCard(response.GetCard())
}

// ListCards, kullanicinin silinmemis kartlari.
func (s *Service) ListCards(ctx context.Context, userID string) (SavedCardList, error) {
	response, err := rpc.Invoke(ctx, s.timeout, service, "ListCards", s.rpc.ListCards, &cardvaultv1.ListCardsRequest{UserId: userID})
	if err != nil {
		return SavedCardList{}, err
	}
	return toSavedCardList(response.GetCards())
}

// DeleteCard, karti siler; cevap guncel liste.
func (s *Service) DeleteCard(ctx context.Context, userID, cardID string) (SavedCardList, error) {
	response, err := rpc.Invoke(ctx, s.timeout, service, "DeleteCard", s.rpc.DeleteCard, &cardvaultv1.DeleteCardRequest{UserId: userID, CardId: cardID})
	if err != nil {
		return SavedCardList{}, err
	}
	return toSavedCardList(response.GetCards())
}
