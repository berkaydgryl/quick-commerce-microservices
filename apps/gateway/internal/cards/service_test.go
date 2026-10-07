package cards

import (
	"context"
	"errors"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	cardvaultv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/cardvault/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// fakeVault, kasanin sahtesi: gelen istegi saklar, verilen cevabi ya da
// hatayi (x-app-error trailer'iyla) doner.
type fakeVault struct {
	added   *cardvaultv1.AddCardRequest
	deleted *cardvaultv1.DeleteCardRequest
	card    *cardvaultv1.SavedCard
	err     error
	trailer metadata.MD
}

func (f *fakeVault) answer(opts []grpc.CallOption) {
	testkit.SetTrailer(opts, f.trailer)
}

func (f *fakeVault) AddCard(_ context.Context, in *cardvaultv1.AddCardRequest, opts ...grpc.CallOption) (*cardvaultv1.AddCardResponse, error) {
	f.added = in
	f.answer(opts)
	if f.err != nil {
		return nil, f.err
	}
	return &cardvaultv1.AddCardResponse{Card: f.card}, nil
}

func (f *fakeVault) ListCards(_ context.Context, _ *cardvaultv1.ListCardsRequest, opts ...grpc.CallOption) (*cardvaultv1.ListCardsResponse, error) {
	f.answer(opts)
	return &cardvaultv1.ListCardsResponse{Cards: []*cardvaultv1.SavedCard{f.card}}, f.err
}

func (f *fakeVault) DeleteCard(_ context.Context, in *cardvaultv1.DeleteCardRequest, opts ...grpc.CallOption) (*cardvaultv1.DeleteCardResponse, error) {
	f.deleted = in
	f.answer(opts)
	return &cardvaultv1.DeleteCardResponse{}, f.err
}

func TestAddCardPassesInputAndUserFromCaller(t *testing.T) {
	vault := &fakeVault{card: protoCard()}
	service := New(vault, time.Second)

	card, err := service.AddCard(context.Background(), "usr_jeton", AddInput{
		Number: "3782 822463 10005", ExpiryMonth: 12, ExpiryYear: 2031, CVV: "9183", HolderName: "Ayşe Yılmaz", Nickname: "İş",
	})

	if err != nil || card.ID != protoCard().GetId() {
		t.Fatalf("ekleme: %+v, %v", card, err)
	}
	if got := vault.added; got.GetUserId() != "usr_jeton" || got.GetCvv() != "9183" || got.GetNickname() != "İş" {
		t.Errorf("kasaya giden istek: %+v", got)
	}
}

func TestVaultValidationSentenceArrivesDecoded(t *testing.T) {
	// QA G4: kasa Turkce cumleyi x-app-error'da \u kacisiyla yazar; REST'e cozulmus gelir.
	vault := &fakeVault{
		err: status.Error(codes.InvalidArgument, "Gecersiz istek"),
		trailer: metadata.Pairs(apperror.MetadataKey,
			`{"code":"VALIDATION_FAILED","message":"Gecersiz istek","details":{"number":"Kart numarası geçersiz"}}`),
	}

	_, err := New(vault, time.Second).AddCard(context.Background(), "usr_jeton", AddInput{})

	var appErr *apperror.Error
	if !errors.As(err, &appErr) || appErr.Code != apperror.CodeValidationFailed {
		t.Fatalf("VALIDATION_FAILED bekleniyordu: %v", err)
	}
	if got := appErr.Details["number"]; got != "Kart numarası geçersiz" {
		t.Errorf("cumle cozulmus gelmeli: %#v", got)
	}
}

func TestDeleteCardSendsCallerAndCard(t *testing.T) {
	vault := &fakeVault{}

	list, err := New(vault, time.Second).DeleteCard(context.Background(), "usr_jeton", "crd_0123456789abcdef0123456789abcdef")

	if err != nil || list.Items == nil || len(list.Items) != 0 {
		t.Fatalf("silme: %+v, %v", list, err)
	}
	if vault.deleted.GetUserId() != "usr_jeton" || vault.deleted.GetCardId() != "crd_0123456789abcdef0123456789abcdef" {
		t.Errorf("kasaya giden istek: %+v", vault.deleted)
	}
}
