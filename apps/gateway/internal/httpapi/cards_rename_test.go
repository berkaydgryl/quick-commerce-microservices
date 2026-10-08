package httpapi

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	cardvaultv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/cardvault/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/cards"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Kart adi duzenleme (#148, PATCH /v1/me/cards/{cardId}): govde SIKI, kullanici
// yalnizca jetondan, eksik ad kasaya eksik gider, 404'ler ayirt edilemez,
// no-store ILK ara katman, hiz siniri kullanici basina (kart basina degil), kart
// adi ne gunlukte ne hata sebebinde.

const cardRenameBody = `{"nickname":"Maaş kartı"}`

func cardPath(cardID string) string {
	return cardsPath + "/" + cardID
}

// renameRequest, verilen kullanici icin kart adi duzenleme istegi.
func renameRequest(t *testing.T, cardID, authorization, key, body string) *http.Request {
	t.Helper()
	return cardRequest(t, http.MethodPatch, cardPath(cardID), authorization, key, body)
}

// vaultRPC, uretilen kasa istemcisinin sahtesi. Gercek cards.Service onu
// cagirir: hata gercek rpc.Invoke/FromGRPC yolundan (x-app-error, sebep) gecer.
// Yalnizca UpdateCardNickname uygulanir; digerleri cagrilmaz.
type vaultRPC struct {
	cards.RPC
	calls   int
	err     error
	trailer metadata.MD
}

func (v *vaultRPC) UpdateCardNickname(_ context.Context, in *cardvaultv1.UpdateCardNicknameRequest, opts ...grpc.CallOption) (*cardvaultv1.UpdateCardNicknameResponse, error) {
	v.calls++
	testkit.SetTrailer(opts, v.trailer)
	if v.err != nil {
		return nil, v.err
	}
	return &cardvaultv1.UpdateCardNicknameResponse{Card: &cardvaultv1.SavedCard{
		Id: testCardID, Brand: cardvaultv1.CardBrand_CARD_BRAND_AMEX, First4: "3782", Last4: "0005",
		ExpiryMonth: 12, ExpiryYear: 2031, HolderName: "Zeynep Kılıçarslan", Nickname: in.GetNickname(),
		CreatedAt: timestamppb.New(time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)),
	}}, nil
}

// fail, sonraki cagrilarin kasa hatasi: gRPC durumu ve x-app-error yuku (bossa yok).
func (v *vaultRPC) fail(code codes.Code, message, appError string) {
	v.err = status.Error(code, message)
	v.trailer = nil
	if appError != "" {
		v.trailer = metadata.Pairs(apperror.MetadataKey, appError)
	}
}

// realRenamer, sahte gRPC istemcili GERCEK kart servisi.
func realRenamer(rpc *vaultRPC) CardRenamer {
	return cards.New(rpc, time.Second)
}

func TestCardRenameUsesTheTokenUserAndReturnsTheMaskedCard(t *testing.T) {
	h := newCardsHarness(t, cardsOptions{})

	status, body := h.rawBody(t, renameRequest(t, testCardID, bearer(t), "anahtar-ad-0001", cardRenameBody))

	if status != http.StatusOK || !strings.Contains(body, `"nickname":"Maaş kartı"`) || !strings.Contains(body, `"last4":"0005"`) {
		t.Fatalf("200 ve guncel maskeli kart bekleniyordu: %d %s", status, body)
	}
	for _, absent := range []string{"378282246310005", "providerToken", "cvv"} {
		if strings.Contains(body, absent) {
			t.Errorf("cevapta %q olmamali: %s", absent, body)
		}
	}
	renames := h.vault.renameCalls()
	if len(renames) != 1 || renames[0].cardID != testCardID || renames[0].nickname == nil || *renames[0].nickname != "Maaş kartı" {
		t.Fatalf("kasaya giden duzenleme: %+v", renames)
	}
	for _, user := range h.vault.users {
		if user != testUserID {
			t.Errorf("kasaya jetondaki kullanici gitmeli: %q", user)
		}
	}
}

func TestCardRenameSendsMissingOrNullNameAsAbsentAndEmptyAsEmpty(t *testing.T) {
	// Eksik ve null alan kasaya EKSIK gider (kasa "Kart adı gönderilmedi" der, ad
	// silinmez); bos metin alan olarak gider (adi kaldirir).
	h := newCardsHarness(t, cardsOptions{})

	for n, body := range []string{`{}`, `{"nickname":null}`, `{"nickname":""}`} {
		h.send(t, renameRequest(t, testCardID, bearer(t), fmt.Sprintf("anahtar-eksik-%04d", n), body))
	}

	renames := h.vault.renameCalls()
	if len(renames) != 3 {
		t.Fatalf("uc istek de kasaya gitmeli: %+v", renames)
	}
	if renames[0].nickname != nil || renames[1].nickname != nil {
		t.Error("eksik ve null ad kasaya eksik gitmeli")
	}
	if renames[2].nickname == nil || *renames[2].nickname != "" {
		t.Error("bos ad kasaya bos metin olarak gitmeli")
	}
}

func TestCardRenameVaultSentenceReachesTheClient(t *testing.T) {
	h := newCardsHarness(t, cardsOptions{})
	h.vault.renameResult = apperror.New(apperror.CodeValidationFailed, map[string]string{"nickname": "Kart adı gönderilmedi"})

	status, envelope := h.statusAndEnvelope(t, renameRequest(t, testCardID, bearer(t), "anahtar-cumle-0002", `{}`))

	if envelope.Error == nil {
		t.Fatalf("hata zarfi bekleniyordu: %d", status)
	}
	details, _ := envelope.Error.Details.(map[string]any)
	if status != http.StatusBadRequest || details["nickname"] != "Kart adı gönderilmedi" {
		t.Errorf("kasanin cumlesi aynen gelmeli: %d %+v", status, envelope.Error)
	}
}

func TestCardRenameBodyIsStrict(t *testing.T) {
	// QA: bilinmeyen alan (numara, CVV, son kullanma, kullanici) 400; yanlis tip
	// 400 ve deger yankilanmaz; hicbiri kasaya gitmez.
	h := newCardsHarness(t, cardsOptions{})
	unknown := map[string]string{
		"number":      `{"nickname":"Yeni","number":"4242 4242 4242 4242"}`,
		"cvv":         `{"nickname":"Yeni","cvv":"123"}`,
		"expiryMonth": `{"nickname":"Yeni","expiryMonth":12}`,
		"userId":      `{"nickname":"Yeni","userId":"usr_ffffffffffffffffffffffffffffffff"}`,
	}
	n := 0
	for field, body := range unknown {
		n++
		status, envelope := h.statusAndEnvelope(t, renameRequest(t, testCardID, bearer(t), fmt.Sprintf("anahtar-siki-%04d", n), body))
		if status != http.StatusBadRequest || envelope.Error == nil {
			t.Errorf("%s: 400 bekleniyordu: %d", field, status)
			continue
		}
		if details, _ := envelope.Error.Details.(map[string]any); details[field] != unknownFieldReason {
			t.Errorf("%s: bilinmeyen alan olarak reddedilmeli: %+v", field, envelope.Error)
		}
	}

	status, raw := h.rawBody(t, renameRequest(t, testCardID, bearer(t), "anahtar-tip-0001", `{"nickname":12345678}`))

	if status != http.StatusBadRequest || !strings.Contains(raw, `"nickname"`) || strings.Contains(testkit.WithoutRandomNoise(raw), "12345678") {
		t.Errorf("yanlis tip 400, alan adiyla ve degersiz olmali: %d %s", status, raw)
	}
	if calls := h.vault.renameCalls(); len(calls) != 0 {
		t.Errorf("reddedilen istekler kasaya gitmemeli: %+v", calls)
	}
}

func TestCardRenameNeedsAnIdempotencyKey(t *testing.T) {
	h := newCardsHarness(t, cardsOptions{})

	status, envelope := h.statusAndEnvelope(t, renameRequest(t, testCardID, bearer(t), "", cardRenameBody))

	if envelope.Error == nil {
		t.Fatalf("hata zarfi bekleniyordu: %d", status)
	}
	details, _ := envelope.Error.Details.(map[string]any)
	if status != http.StatusBadRequest || details[IdempotencyKeyHeader] == nil {
		t.Errorf("anahtarsiz duzenleme 400 olmali: %d %+v", status, envelope.Error)
	}
	if calls := h.vault.renameCalls(); len(calls) != 0 {
		t.Errorf("anahtarsiz istek kasaya gitmemeli: %+v", calls)
	}
}

func TestCardRenameNotFoundIsIndistinguishable(t *testing.T) {
	// Bicimsiz kimlik kasaya gitmeden 404. Kasanin 404'u (yok, baskasinin,
	// silinmis) x-app-error ayrintisinda kart kimligini tasir; cards.Service onu
	// atar: dordu AYNI zarf. Gercek servis + sahte gRPC istemcisi.
	rpc := &vaultRPC{}
	h := newCardsHarness(t, cardsOptions{renamer: realRenamer(rpc)})

	malformedStatus, malformed := h.statusAndEnvelope(t, renameRequest(t, "crd_bicimsiz", bearer(t), "anahtar-yok-0001", cardRenameBody))
	if rpc.calls != 0 {
		t.Fatalf("bicimsiz kimlik kasaya gitmemeli: %d", rpc.calls)
	}
	rpc.fail(codes.NotFound, "Kart bulunamadi", `{"code":"NOT_FOUND","message":"Kart bulunamadi","details":{"cardId":"`+testCardID+`"}}`)
	vaultStatus, vault := h.statusAndEnvelope(t, renameRequest(t, testCardID, bearer(t), "anahtar-yok-0002", cardRenameBody))

	if malformedStatus != http.StatusNotFound || vaultStatus != http.StatusNotFound || malformed.Error == nil || vault.Error == nil {
		t.Fatalf("iki istek de 404 olmali: %d %d", malformedStatus, vaultStatus)
	}
	malformed.Error.RequestID, vault.Error.RequestID = "", ""
	if !reflect.DeepEqual(malformed.Error, vault.Error) || vault.Error.Details != nil {
		t.Errorf("404'ler ayirt edilebiliyor: %+v / %+v", *malformed.Error, *vault.Error)
	}
}

func TestCardRenameIsNeverCachedEvenWhenRejectedEarly(t *testing.T) {
	// QA: noStoreRoute ILK ara katman. Kimliksiz (401) ve hiz siniri (429) ucun
	// handler'ina varmadan doner; onlarda da no-store.
	h := newCardsHarness(t, cardsOptions{general: 4})
	cases := []struct {
		request *http.Request
		status  int
	}{
		{renameRequest(t, testCardID, bearer(t), "anahtar-onbellek-11", cardRenameBody), http.StatusOK},
		{renameRequest(t, testCardID, "", "anahtar-onbellek-12", cardRenameBody), http.StatusUnauthorized},
		{renameRequest(t, testCardID, bearer(t), "", cardRenameBody), http.StatusBadRequest},
		{renameRequest(t, "crd_bicimsiz", bearer(t), "anahtar-onbellek-13", cardRenameBody), http.StatusNotFound},
		{renameRequest(t, testCardID, bearer(t), "anahtar-onbellek-14", `{"nickname":"Yeni","cvv":"123"}`), http.StatusBadRequest},
		{renameRequest(t, testCardID, bearer(t), "anahtar-onbellek-15", cardRenameBody), http.StatusTooManyRequests},
	}
	for _, tc := range cases {
		status, headers := h.send(t, tc.request)
		if status != tc.status {
			t.Errorf("%s: durum %d, beklenen %d", tc.request.URL, status, tc.status)
		}
		if got := headers.Get(fiber.HeaderCacheControl); got != noStore {
			t.Errorf("%d: Cache-Control %q", status, got)
		}
	}
}

func TestCardRenameIsRateLimitedPerUserNotPerCard(t *testing.T) {
	// Kullanici basina genel sinir (diger kart uclariyla ayni). Sayac rota KALIBINA
	// gore tutulur: farkli kartlar ayni sayaca duser; baska kullanici etkilenmez.
	h := newCardsHarness(t, cardsOptions{general: 2})
	other := "crd_" + strings.Repeat("b", 32)
	third := "crd_" + strings.Repeat("c", 32)

	first, _ := h.send(t, renameRequest(t, testCardID, bearer(t), "anahtar-sinir-0001", cardRenameBody))
	second, _ := h.send(t, renameRequest(t, other, bearer(t), "anahtar-sinir-0002", cardRenameBody))
	limited, headers := h.send(t, renameRequest(t, third, bearer(t), "anahtar-sinir-0003", cardRenameBody))
	stranger, _ := h.send(t, renameRequest(t, testCardID, tokenFor(t, "usr_"+strings.Repeat("e", 32)), "anahtar-sinir-0004", cardRenameBody))

	if first != http.StatusOK || second != http.StatusOK {
		t.Fatalf("sinir icinde 200 bekleniyordu: %d %d", first, second)
	}
	if limited != http.StatusTooManyRequests || headers.Get(fiber.HeaderRetryAfter) == "" {
		t.Errorf("ucuncu kart da ayni sayaca dusmeli (429 + Retry-After): %d", limited)
	}
	if stranger != http.StatusOK {
		t.Errorf("baska kullanici etkilenmemeli: %d", stranger)
	}
}

func TestCardRenameReplaysWithTheSameKeyAndLivesShort(t *testing.T) {
	h := newCardsHarness(t, cardsOptions{})
	key := "anahtar-ad-tekrar-01"

	h.send(t, renameRequest(t, testCardID, bearer(t), key, cardRenameBody))
	replayed, headers := h.send(t, renameRequest(t, testCardID, bearer(t), key, cardRenameBody))
	other, _ := h.send(t, renameRequest(t, testCardID, bearer(t), key, `{"nickname":"Başka ad"}`))

	if replayed != http.StatusOK || headers.Get(IdempotentReplayedHeader) != "true" {
		t.Errorf("ayni anahtar ilk cevabi tekrar etmeli: %d %q", replayed, headers.Get(IdempotentReplayedHeader))
	}
	if other != http.StatusConflict {
		t.Errorf("ayni anahtar + farkli ad 409 olmali: %d", other)
	}
	if calls := h.vault.renameCalls(); len(calls) != 1 {
		t.Errorf("kasaya bir kez gidilmeli: %d", len(calls))
	}
	// Bitmis kayit TEK ve kisa omurlu. Saklanan cevap guncel MASKELI karttir:
	// kart adini acik tasir (eklemenin ve silmenin cevabi gibi), numarayi,
	// CVV'yi ve saglayici jetonunu tasimaz. Parmak izi govdenin HMAC'idir.
	var done []int
	for n, record := range h.store.saved {
		if record.State == idempotency.StateDone {
			done = append(done, n)
		}
	}
	if len(done) != 1 {
		t.Fatalf("tek bitmis kayit bekleniyordu: %d", len(done))
	}
	record, ttl := h.store.saved[done[0]], h.store.ttls[done[0]]
	if ttl != cards.IdempotencyTTL {
		t.Errorf("kart adi kaydi %v yasamali: %v", cards.IdempotencyTTL, ttl)
	}
	stored := string(record.Body)
	if !strings.Contains(stored, `"last4":"0005"`) || !strings.Contains(stored, `"nickname":"Maaş kartı"`) {
		t.Errorf("saklanan cevap guncel maskeli kart olmali: %s", stored)
	}
	for _, absent := range []string{"378282246310005", "providerToken", "cvv"} {
		if strings.Contains(stored, absent) {
			t.Errorf("saklanan cevapta %q olmamali", absent)
		}
	}
	if strings.Contains(record.Fingerprint, "Maaş") {
		t.Error("parmak izinde kart adi")
	}
}

func TestCardRenameWritesNoNicknameToTheLogOrTheErrorCause(t *testing.T) {
	// QA: kart adi ne istek satirinda ne hata sebebinde (DEBUG dahil): basari,
	// bilinmeyen alan, yanlis tip, ikinci JSON degeri, kimliksiz, bicimsiz kimlik,
	// kasa dogrulama reddi ve sunucu hatasi. Kasa hatalari GERCEK rpc yolundan
	// gecer: gunluge giden sebep "payment UpdateCardNickname: rpc error: ...".
	var output lockedBuffer
	logger := slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug}))
	rpc := &vaultRPC{}
	h := newCardsHarness(t, cardsOptions{logger: logger, renamer: realRenamer(rpc)})
	const secret = "Gizli Yeni Ad"
	body := `{"nickname":"` + secret + `"}`
	requests := []*http.Request{
		renameRequest(t, testCardID, bearer(t), "anahtar-gunluk-0101", body),
		renameRequest(t, testCardID, bearer(t), "anahtar-gunluk-0102", `{"nickname":"`+secret+`","number":"4242"}`),
		renameRequest(t, testCardID, bearer(t), "anahtar-gunluk-0103", `{"nickname":["`+secret+`"]}`),
		renameRequest(t, testCardID, bearer(t), "anahtar-gunluk-0104", body+" "+body),
		renameRequest(t, testCardID, "", "anahtar-gunluk-0105", body),
		renameRequest(t, "crd_bicimsiz", bearer(t), "anahtar-gunluk-0106", body),
	}
	for _, request := range requests {
		h.send(t, request)
	}
	rpc.fail(codes.InvalidArgument, "Gecersiz istek", `{"code":"VALIDATION_FAILED","message":"Gecersiz istek","details":{"nickname":"Kart adında 8 ya da daha fazla rakam yan yana olamaz"}}`)
	h.send(t, renameRequest(t, testCardID, bearer(t), "anahtar-gunluk-0107", `{"nickname":"`+secret+` 87654321"}`))
	rpc.fail(codes.Internal, "kasa dustu", "")
	h.send(t, renameRequest(t, testCardID, bearer(t), "anahtar-gunluk-0108", body))

	text := testkit.WithoutRandomNoise(output.String())
	if !strings.Contains(text, "payment UpdateCardNickname: rpc error") || !strings.Contains(text, "kasa dustu") {
		t.Fatalf("sunucu hatasinin sebebi gunlukte olmali (test sebebi okuyor mu?):\n%s", text)
	}
	if strings.Count(text, "http istegi") < len(requests)+2 {
		t.Fatalf("her istek gunlukte bir satir olmali:\n%s", text)
	}
	for _, leaked := range []string{secret, "87654321"} {
		if strings.Contains(text, leaked) {
			t.Errorf("gunlukte kart adi (%d karakter) bulundu", len(leaked))
		}
	}
}

func TestCardRenameIsAbsentWhenTheVaultIsOff(t *testing.T) {
	// K1: kart uclari kapaliyken PATCH de baglanmaz.
	app := New(Deps{Health: fakeReporter{report: healthyReport()}, AccessTokens: testTokens(), Idempotency: testIdempotency(), Logger: silentLogger()})

	response, err := app.Test(renameRequest(t, testCardID, bearer(t), "anahtar-kapali-0002", cardRenameBody))
	if err != nil {
		t.Fatalf("istek: %v", err)
	}
	closeBody(t, response)
	if response.StatusCode != http.StatusNotFound {
		t.Errorf("uclar kapaliyken 404 bekleniyordu: %d", response.StatusCode)
	}
}
