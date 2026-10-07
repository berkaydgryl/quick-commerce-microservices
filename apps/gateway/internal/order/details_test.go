package order

import (
	"context"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	orderv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/order/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Siparis ayrintisi (T12.4): kurallar, tele giden istek, 3DS kalan suresi ve
// ayrintinin YALNIZCA tek siparis okumasinda donmesi.

const testCardID = "crd_0123456789abcdef0123456789abcdef"

func validGift() *Gift {
	return &Gift{Message: "İyi ki doğdun", SenderName: "Ayşe", RecipientName: "Zeynep Kaya", RecipientPhone: "+905321112233"}
}

func TestDetailsNormalizedTrimsLikeJavaScriptAndAcceptsLimitsInUTF16Units(t *testing.T) {
	// Emoji (😀) iki UTF-16 birimidir: 125 emoji = 250 birim, sinirda gecer.
	// JavaScript trim U+FEFF'i kirpar, U+0085'i kirpmaz (Go'nun tersi).
	original := Details{
		Gift:               &Gift{Message: strings.Repeat("😀", 125), SenderName: strings.Repeat("ş", GiftNameMax), RecipientName: "\u00a0 Zeynep \ufeff", RecipientPhone: "+905321112233"},
		Note:               "\ufeff" + strings.Repeat("n", CheckoutTextMax) + "  ",
		AgreementsAccepted: true,
	}

	details := original.Normalized()

	if problems := details.Problems(); len(problems) != 0 {
		t.Fatalf("sinirdaki ayrinti gecmeli: %v", problems)
	}
	if details.Note != strings.Repeat("n", CheckoutTextMax) || details.Gift.RecipientName != "Zeynep" {
		t.Errorf("metinler kirpilmali: %q %q", details.Note, details.Gift.RecipientName)
	}
	if original.Gift.RecipientName != "\u00a0 Zeynep \ufeff" {
		t.Error("Normalized kopya donmeli; girdi degismemeli")
	}
	if trimJS("\u0085Ali\u0085") != "\u0085Ali\u0085" {
		t.Error("U+0085 JavaScript'te bosluk degildir: kirpilmamali")
	}
}

func TestDetailsCheckReportsEachRuleWithContractReason(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*Details)
		field  string
		reason string
	}{
		{"not 251", func(d *Details) { d.Note = strings.Repeat("n", CheckoutTextMax+1) }, fieldNote, noteLengthReason},
		{"onay yok", func(d *Details) { d.AgreementsAccepted = false }, fieldAgreementsAccepted, agreementsReason},
		// 126 emoji = 252 birim (rune sayisi 126 olsa da asar).
		{"mesaj 252 birim", func(d *Details) { d.Gift.Message = strings.Repeat("😀", 126) }, fieldGiftMessage, giftMessageLengthReason},
		{"gonderen 61", func(d *Details) { d.Gift.SenderName = strings.Repeat("s", GiftNameMax+1) }, fieldGiftSenderName, giftNameLengthReason},
		{"alici bosluk", func(d *Details) { d.Gift.RecipientName = "   " }, fieldGiftRecipientName, recipientNameReason},
		{"alici 61", func(d *Details) { d.Gift.RecipientName = strings.Repeat("a", GiftNameMax+1) }, fieldGiftRecipientName, giftNameLengthReason},
		{"telefon 0'la", func(d *Details) { d.Gift.RecipientPhone = "05321112233" }, fieldGiftRecipientPhone, giftPhoneReason},
		{"telefon bosluklu", func(d *Details) { d.Gift.RecipientPhone = " +905321112233" }, fieldGiftRecipientPhone, giftPhoneReason},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			details := Details{Gift: validGift(), AgreementsAccepted: true}
			tc.mutate(&details)

			problems := details.Normalized().Problems()

			if len(problems) != 1 || problems[tc.field] != tc.reason {
				t.Errorf("tek sorun bekleniyordu %s=%q: %v", tc.field, tc.reason, problems)
			}
		})
	}
}

func TestCardPaymentFollowsContractOrder(t *testing.T) {
	text := func(value string) *string { return &value }
	for _, tc := range []struct {
		name   string
		choice PaymentChoice
		want   map[string]string
	}{
		{"kayitli kart", PaymentChoice{Method: MethodCard, CardID: text(testCardID)}, map[string]string{}},
		{"eski jeton (kirpilir)", PaymentChoice{Method: MethodCard, CardToken: text(" tok_test_4242 ")}, map[string]string{}},
		{"ikisi", PaymentChoice{Method: MethodCard, CardID: text(testCardID), CardToken: text("tok_test_4242")}, map[string]string{fieldCardID: paymentCardReason}},
		{"hicbiri", PaymentChoice{Method: MethodCard}, map[string]string{fieldCardID: paymentCardReason}},
		// Bicim once: gonderilen bos kimlik "yok" sayilmaz, bicimsizdir.
		{"bos kimlik + jeton", PaymentChoice{Method: MethodCard, CardID: text(""), CardToken: text("tok_test_4242")}, map[string]string{fieldCardID: cardIDReason}},
		{"kirpilmayan kimlik", PaymentChoice{Method: MethodCard, CardID: text(" " + testCardID)}, map[string]string{fieldCardID: cardIDReason}},
		{"buyuk harfli hex", PaymentChoice{Method: MethodCard, CardID: text(strings.ToUpper(testCardID))}, map[string]string{fieldCardID: cardIDReason}},
		{"bosluk jeton", PaymentChoice{Method: MethodCard, CardToken: text("   ")}, map[string]string{fieldCardToken: cardTokenReason}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.choice.Normalized().Problems(); testkit.JSON(t, got) != testkit.JSON(t, tc.want) {
				t.Errorf("sonuc %v, beklenen %v", got, tc.want)
			}
		})
	}
}

func TestPlaceSendsSavedCardAndDetailsAndCountsDownThreeDS(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	stub := &stubServer{placeResponse: &orderv1.CreateOrderResponse{
		OrderId:            orderID,
		Status:             orderv1.OrderStatus_ORDER_STATUS_AWAITING_PAYMENT,
		ChallengeId:        "tds_1",
		ChallengeExpiresAt: timestamppb.New(now.Add(59*time.Second + 300*time.Millisecond)),
	}}
	service := startStub(t, stub)
	service.now = func() time.Time { return now }

	placement, err := service.Place(context.Background(), PlaceInput{Method: MethodCard,
		UserID: "usr_1", OrderID: orderID, CardID: testCardID, IdempotencyKey: "anahtar-0002",
		Details: Details{Gift: validGift(), Note: "Zili çalma", DoNotRingBell: true, AgreementsAccepted: true},
	})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	sent := stub.placeRequest
	if sent.GetCardId() != testCardID || sent.GetCardToken() != "" {
		t.Errorf("kayitli kart tasinmali, jeton bos: %v", sent)
	}
	details := sent.GetDetails()
	if details.GetNote() != "Zili çalma" || !details.GetDoNotRingBell() || !details.GetAgreementsAccepted() ||
		details.GetGift().GetRecipientPhone() != "+905321112233" || details.GetGift().GetRecipientName() != "Zeynep Kaya" {
		t.Errorf("ayrinti tasinmali: %v", details)
	}
	if details.GetAgreementsAcceptedAt() != nil {
		t.Error("onay ani istekte GONDERILMEZ (order sunucu saatiyle yazar)")
	}
	// Kalan sure yukari yuvarlanir (59,3 sn -> 60), reservation ile ayni kural.
	if got := testkit.JSON(t, placement); got != `{"orderId":"`+orderID+`","status":"AWAITING_PAYMENT","threeDs":{"challengeId":"tds_1","ttlSeconds":60}}` {
		t.Errorf("cevap: %s", got)
	}
}

func TestThreeDSTTLNeverNegativeWhenClocksDrift(t *testing.T) {
	// payment'in saati gateway'inkinden geride: bitis gateway'e gore gecmiste.
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	stub := &stubServer{placeResponse: &orderv1.CreateOrderResponse{
		OrderId: orderID, Status: orderv1.OrderStatus_ORDER_STATUS_AWAITING_PAYMENT,
		ChallengeId: "tds_1", ChallengeExpiresAt: timestamppb.New(now.Add(-90 * time.Second)),
	}}
	service := startStub(t, stub)
	service.now = func() time.Time { return now }

	placement, err := service.Place(context.Background(), PlaceInput{Method: MethodCard, UserID: "usr_1", OrderID: orderID, CardID: testCardID, IdempotencyKey: "anahtar-0002"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if ttl := placement.ThreeDS.TTLSeconds; ttl == nil || *ttl != 0 {
		t.Errorf("kayan saatte kalan sure 0 olmali (negatif degil): %v", ttl)
	}
}

func TestThreeDSWithoutExpiryOmitsTTL(t *testing.T) {
	// Eski order (bitis gondermez): alan HIC yazilmaz, uydurma sure yok.
	stub := &stubServer{placeResponse: &orderv1.CreateOrderResponse{
		OrderId: orderID, Status: orderv1.OrderStatus_ORDER_STATUS_AWAITING_PAYMENT, ChallengeId: "tds_1",
	}}
	service := startStub(t, stub)

	placement, err := service.Place(context.Background(), PlaceInput{Method: MethodCard, UserID: "usr_1", OrderID: orderID, CardID: testCardID, IdempotencyKey: "anahtar-0002"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if got := testkit.JSON(t, placement.ThreeDS); got != `{"challengeId":"tds_1"}` {
		t.Errorf("ttlSeconds yazilmamali: %s", got)
	}
}

// detailedOrder, ayrintili ve odenmis siparis (proto).
func detailedOrder() *orderv1.Order {
	at := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	return &orderv1.Order{
		Id: orderID, Status: orderv1.OrderStatus_ORDER_STATUS_PAID, CreatedAt: timestamppb.New(at),
		Details: &orderv1.OrderDetails{
			Gift:                 &orderv1.GiftDetails{Message: "İyi ki doğdun", SenderName: "Ayşe", RecipientName: "Zeynep Kaya", RecipientPhone: "+905321112233"},
			Note:                 "Zili çalma",
			DoNotRingBell:        true,
			AgreementsAccepted:   true,
			AgreementsAcceptedAt: timestamppb.New(at),
		},
	}
}

func TestGetDetailedMapsDetailsForTheOwner(t *testing.T) {
	stub := &stubServer{order: detailedOrder()}
	service := startStub(t, stub)

	found, err := service.GetDetailed(context.Background(), "usr_1", orderID)
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	want := `{"gift":{"message":"İyi ki doğdun","senderName":"Ayşe","recipientName":"Zeynep Kaya","recipientPhone":"+905321112233"},` +
		`"note":"Zili çalma","doNotRingBell":true,"agreementsAccepted":true,"agreementsAcceptedAt":"2026-10-07T12:00:00Z"}`
	if got := testkit.JSON(t, found.Details); got != want {
		t.Errorf("ayrinti:\n got %s\nwant %s", got, want)
	}
}

func TestPageNeverMapsDetailsEvenIfTheServiceSendsThem(t *testing.T) {
	// Liste ayrinti TASIMAZ (order zaten gondermez); servis gonderse de eslenmez.
	stub := &stubServer{listResponse: &orderv1.ListMyOrdersResponse{Orders: []*orderv1.Order{detailedOrder()}}}
	service := startStub(t, stub)

	page, err := service.Page(context.Background(), "usr_1", 20, "")
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if len(page.Orders) != 1 {
		t.Fatalf("tek siparis bekleniyordu: %+v", page.Orders)
	}
	if got := testkit.JSON(t, page); strings.Contains(got, "Zeynep") || strings.Contains(got, "details") {
		t.Errorf("liste kisisel veri tasimamali: %s", got)
	}
}

func TestBrokenDetailsFailOnlyTheDetailedRead(t *testing.T) {
	// Onay ani yoksa servis sozlesmeyi bozmustur: uydurma an istemciye gitmez
	// (INTERNAL). Ayrintisiz okuma (oda jetonunun sahiplik denetimi, "zaten
	// iptal" yolu) ayrintiya bakmaz ve etkilenmez.
	broken := detailedOrder()
	broken.Details.AgreementsAcceptedAt = nil
	service := startStub(t, &stubServer{order: broken})

	_, err := service.GetDetailed(context.Background(), "usr_1", orderID)
	if code := testkit.AppErrorOf(t, err).Code; code != apperror.CodeInternal {
		t.Errorf("ayrintili okuma INTERNAL bekleniyordu: %s", code)
	}
	if _, err := service.Get(context.Background(), "usr_1", orderID); err != nil {
		t.Errorf("ayrintisiz okuma etkilenmemeli: %v", err)
	}
}

func TestMissingSavedCardIsNotFoundWithCardResourceAndValidationNamesAreREST(t *testing.T) {
	// Kart kasada yok, silinmis ya da baskasinin: order NOT_FOUND + resource
	// "card" doner (ikisi ayni cevap); REST'e 404 olarak AYNEN gecer.
	stub := &stubServer{
		err:     status.Error(codes.NotFound, "kart yok"),
		trailer: metadata.Pairs(apperror.MetadataKey, `{"code":"NOT_FOUND","message":"x","details":{"resource":"card"}}`),
	}
	service := startStub(t, stub)
	input := PlaceInput{Method: MethodCard, UserID: "usr_1", OrderID: orderID, CardID: testCardID, IdempotencyKey: "anahtar-0002"}

	_, err := service.Place(context.Background(), input)

	appErr := testkit.AppErrorOf(t, err)
	if appErr.Code != apperror.CodeNotFound || testkit.JSON(t, appErr.Details) != `{"resource":"card"}` {
		t.Errorf("NOT_FOUND + resource card bekleniyordu: %s %v", appErr.Code, appErr.Details)
	}

	// order'in alan yollari REST adina cevrilir: kart kimligi odeme nesnesinde,
	// ayrinti yollari REST'tekiyle ayni.
	stub.err = status.Error(codes.InvalidArgument, "gecersiz")
	stub.trailer = metadata.Pairs(apperror.MetadataKey,
		`{"code":"VALIDATION_FAILED","message":"x","details":{"cardId":"kart kimligi bekleniyor","details.gift.recipientPhone":"r"}}`)
	_, err = service.Place(context.Background(), input)
	if got := testkit.JSON(t, testkit.AppErrorOf(t, err).Details); got != `{"details.gift.recipientPhone":"r","payment.cardId":"kart kimligi bekleniyor"}` {
		t.Errorf("REST alan adlari bekleniyordu: %s", got)
	}
}
