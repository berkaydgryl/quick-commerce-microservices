package cards

import (
	"context"
	"errors"
	"fmt"
	"strings"
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
	renamed *cardvaultv1.UpdateCardNicknameRequest
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

func (f *fakeVault) UpdateCardNickname(_ context.Context, in *cardvaultv1.UpdateCardNicknameRequest, opts ...grpc.CallOption) (*cardvaultv1.UpdateCardNicknameResponse, error) {
	f.renamed = in
	f.answer(opts)
	if f.err != nil {
		return nil, f.err
	}
	return &cardvaultv1.UpdateCardNicknameResponse{Card: f.card}, nil
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

func TestUpdateCardNicknameSendsCallerCardAndNameAndMapsTheCard(t *testing.T) {
	renamed := protoCard()
	renamed.Nickname = "Maaş kartı"
	vault := &fakeVault{card: renamed}
	nickname := "Maaş kartı"

	card, err := New(vault, time.Second).UpdateCardNickname(context.Background(), "usr_jeton", "crd_0123456789abcdef0123456789abcdef", &nickname)

	if err != nil || card.ID != renamed.GetId() || card.Nickname != "Maaş kartı" || card.Last4 != "0005" {
		t.Fatalf("duzenleme: %+v, %v", card, err)
	}
	got := vault.renamed
	if got.GetUserId() != "usr_jeton" || got.GetCardId() != "crd_0123456789abcdef0123456789abcdef" || got.Nickname == nil || got.GetNickname() != "Maaş kartı" {
		t.Errorf("kasaya giden istek: %+v", got)
	}
}

func TestUpdateCardNicknameKeepsMissingAndEmptyApart(t *testing.T) {
	// #148: eksik alan kasaya EKSIK gider (kasa "Kart adı gönderilmedi" der); bos
	// metin alan olarak gider (adi kaldirir). Ikisi proto'da ayrilir.
	missing := &fakeVault{card: protoCard()}
	empty := &fakeVault{card: protoCard()}
	blank := ""

	_, missingErr := New(missing, time.Second).UpdateCardNickname(context.Background(), "usr_jeton", "crd_0123456789abcdef0123456789abcdef", nil)
	_, emptyErr := New(empty, time.Second).UpdateCardNickname(context.Background(), "usr_jeton", "crd_0123456789abcdef0123456789abcdef", &blank)

	if missingErr != nil || emptyErr != nil {
		t.Fatalf("hatalar: %v, %v", missingErr, emptyErr)
	}
	if missing.renamed.Nickname != nil {
		t.Error("eksik ad kasaya alan olarak gitmemeli")
	}
	if empty.renamed.Nickname == nil || empty.renamed.GetNickname() != "" {
		t.Errorf("bos ad kasaya bos metin olarak gitmeli: %+v", empty.renamed)
	}
}

func TestUpdateCardNicknameNotFoundHasNoDetails(t *testing.T) {
	// Kart yok, baskasinin ya da silinmis: kasanin NOT_FOUND'u kart kimligini
	// ayrintiya koyar; gateway'in bicimsiz kimlik 404'u koymaz. Ayrinti atilir,
	// kasanin sebebi gunluk icin kalir.
	vault := &fakeVault{
		err:     status.Error(codes.NotFound, "Kart bulunamadi"),
		trailer: metadata.Pairs(apperror.MetadataKey, `{"code":"NOT_FOUND","message":"Kart bulunamadi","details":{"cardId":"crd_0123456789abcdef0123456789abcdef"}}`),
	}
	nickname := "Yabanci"

	_, err := New(vault, time.Second).UpdateCardNickname(context.Background(), "usr_jeton", "crd_0123456789abcdef0123456789abcdef", &nickname)

	var appErr *apperror.Error
	if !errors.As(err, &appErr) || appErr.Code != apperror.CodeNotFound {
		t.Fatalf("NOT_FOUND bekleniyordu: %v", err)
	}
	if appErr.Details != nil {
		t.Errorf("404 ayrintisiz olmali: %v", appErr.Details)
	}
	if !strings.Contains(err.Error(), "payment UpdateCardNickname") || strings.Count(err.Error(), "NOT_FOUND") != 1 {
		t.Errorf("kasanin sebebi bir kez kalmali: %v", err)
	}
}

func TestUpdateCardNicknameErrorChainHoldsNoNickname(t *testing.T) {
	// QA: gunluge giden sebep (rpc.Invoke + FromGRPC zinciri) kart adini tasimaz;
	// yalnizca servis ve yontem adi, gRPC durumu ve kasanin (degersiz) cumlesi.
	nickname := "Gizli Yeni Ad"
	for _, vault := range []*fakeVault{
		{err: status.Error(codes.InvalidArgument, "Gecersiz istek"), trailer: metadata.Pairs(apperror.MetadataKey,
			`{"code":"VALIDATION_FAILED","message":"Gecersiz istek","details":{"nickname":"Kart adı en fazla 30 karakter olabilir"}}`)},
		{err: status.Error(codes.Internal, "kasa dustu")},
		{err: status.Error(codes.DeadlineExceeded, "context deadline exceeded")},
	} {
		_, err := New(vault, time.Second).UpdateCardNickname(context.Background(), "usr_jeton", "crd_0123456789abcdef0123456789abcdef", &nickname)

		chain := fmt.Sprintf("%v %+v", err, err)
		if err == nil || !strings.Contains(chain, "UpdateCardNickname") {
			t.Fatalf("hata zinciri bekleniyordu: %v", err)
		}
		if strings.Contains(chain, nickname) {
			t.Errorf("hata zincirinde kart adi: %s", chain)
		}
	}
}

func TestDeleteCardNotFoundHasNoDetails(t *testing.T) {
	// #194: silmede de kasanin 404'u (yok, baskasinin, silinmis) kart kimligini
	// ayrintiya koyar; ayrinti atilir, sebep kalir (ad duzenlemeyle ayni).
	vault := &fakeVault{
		err:     status.Error(codes.NotFound, "Kart bulunamadi"),
		trailer: metadata.Pairs(apperror.MetadataKey, `{"code":"NOT_FOUND","message":"Kart bulunamadi","details":{"cardId":"crd_0123456789abcdef0123456789abcdef"}}`),
	}

	_, err := New(vault, time.Second).DeleteCard(context.Background(), "usr_jeton", "crd_0123456789abcdef0123456789abcdef")

	var appErr *apperror.Error
	if !errors.As(err, &appErr) || appErr.Code != apperror.CodeNotFound {
		t.Fatalf("NOT_FOUND bekleniyordu: %v", err)
	}
	if appErr.Details != nil {
		t.Errorf("404 ayrintisiz olmali: %v", appErr.Details)
	}
	if !strings.Contains(err.Error(), "payment DeleteCard") || strings.Count(err.Error(), "NOT_FOUND") != 1 {
		t.Errorf("kasanin sebebi bir kez kalmali: %v", err)
	}
}
