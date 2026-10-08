package httpapi

import (
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
	"google.golang.org/grpc/codes"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// Kart uclari (T11.17): kimlik yalnizca jetondan (QA G6), no-store (G7),
// maskeli ve kart adisiz cevap (G4), kapali uclar (G5, K1).

func TestCardEndpointsUseTheUserFromTheTokenOnly(t *testing.T) {
	// G6: govdede ya da sorguda kullanici alani tasinamaz; kasaya jetonun kullanicisi gider.
	h := newCardsHarness(t, cardsOptions{})
	authorization := bearer(t)

	added, _ := h.send(t, cardRequest(t, http.MethodPost, cardsPath, authorization, "anahtar-ekle-0001", cardAddBody))
	listed, _ := h.send(t, cardRequest(t, http.MethodGet, cardsPath, authorization, "", ""))
	deleted, _ := h.send(t, cardRequest(t, http.MethodDelete, cardsPath+"/"+testCardID, authorization, "anahtar-sil-0001", ""))

	if added != http.StatusCreated || listed != http.StatusOK || deleted != http.StatusOK {
		t.Fatalf("durumlar: %d %d %d", added, listed, deleted)
	}
	for _, user := range h.vault.users {
		if user != testUserID {
			t.Errorf("kasaya jetondaki kullanici gitmeli: %q", user)
		}
	}
}

func TestUserFieldInBodyOrQueryIsRejected(t *testing.T) {
	h := newCardsHarness(t, cardsOptions{})
	foreign := strings.Replace(cardAddBody, `{`, `{"userId":"usr_ffffffffffffffffffffffffffffffff",`, 1)

	inBody := h.envelope(t, cardRequest(t, http.MethodPost, cardsPath, bearer(t), "anahtar-govde-0001", foreign))
	inQuery := h.envelope(t, cardRequest(t, http.MethodGet, cardsPath+"?userId=usr_ffffffffffffffffffffffffffffffff", bearer(t), "", ""))

	for name, envelope := range map[string]Envelope{"govde": inBody, "sorgu": inQuery} {
		if envelope.Error == nil || envelope.Error.Code != apperror.CodeValidationFailed {
			t.Errorf("%s: VALIDATION_FAILED bekleniyordu: %+v", name, envelope.Error)
		}
	}
	if h.vault.addCalls() != 0 {
		t.Error("gecersiz istek kasaya gitmemeli")
	}
}

func TestCardResponsesAreNeverCached(t *testing.T) {
	// G7: basari ve hata cevaplari (kimliksiz, gecersiz) no-store.
	h := newCardsHarness(t, cardsOptions{})
	requests := []*http.Request{
		cardRequest(t, http.MethodGet, cardsPath, bearer(t), "", ""),
		cardRequest(t, http.MethodPost, cardsPath, bearer(t), "anahtar-onbellek-01", cardAddBody),
		cardRequest(t, http.MethodGet, cardsPath, "", "", ""),
		cardRequest(t, http.MethodPost, cardsPath, bearer(t), "", cardAddBody),
		cardRequest(t, http.MethodDelete, cardsPath+"/crd_bicimsiz", bearer(t), "anahtar-onbellek-02", ""),
	}
	for _, request := range requests {
		status, headers := h.send(t, request)
		if got := headers.Get(fiber.HeaderCacheControl); got != noStore {
			t.Errorf("%s %s (%d): Cache-Control %q", request.Method, request.URL, status, got)
		}
	}
}

func TestAddedCardIsMaskedAndHasNoEmptyNickname(t *testing.T) {
	// G4: cevap maskeli; proto'dan bos gelen kart adi alansiz.
	h := newCardsHarness(t, cardsOptions{})

	status, body := h.rawBody(t, cardRequest(t, http.MethodPost, cardsPath, bearer(t), "anahtar-maske-0001", cardAddBody))

	if status != http.StatusCreated || !strings.Contains(body, `"last4":"0005"`) {
		t.Fatalf("201 ve maskeli kart bekleniyordu: %d %s", status, body)
	}
	for _, absent := range []string{"nickname", "378282246310005", "providerToken", "cvv"} {
		if strings.Contains(body, absent) {
			t.Errorf("cevapta %q olmamali: %s", absent, body)
		}
	}
}

func TestVaultSentenceReachesTheClientDecoded(t *testing.T) {
	// G4: kasanin Turkce cumlesi REST zarfina aynen gecer.
	h := newCardsHarness(t, cardsOptions{})
	h.vault.addResult = func(int) error {
		return apperror.New(apperror.CodeValidationFailed, map[string]string{"number": "Kart numarası geçersiz"})
	}

	envelope := h.envelope(t, cardRequest(t, http.MethodPost, cardsPath, bearer(t), "anahtar-cumle-0001", cardAddBody))

	details, _ := envelope.Error.Details.(map[string]any)
	if envelope.Error.Code != apperror.CodeValidationFailed || details["number"] != "Kart numarası geçersiz" {
		t.Errorf("cumle aynen gelmeli: %+v", envelope.Error)
	}
}

func TestIdempotencyKeyIsRequiredAndMalformedCardIDIsNotFound(t *testing.T) {
	h := newCardsHarness(t, cardsOptions{})

	addWithoutKey := h.envelope(t, cardRequest(t, http.MethodPost, cardsPath, bearer(t), "", cardAddBody))
	deleteWithoutKey := h.envelope(t, cardRequest(t, http.MethodDelete, cardsPath+"/"+testCardID, bearer(t), "", ""))
	malformed, _ := h.send(t, cardRequest(t, http.MethodDelete, cardsPath+"/crd_$ne", bearer(t), "anahtar-bicim-0001", ""))

	for name, envelope := range map[string]Envelope{"ekleme": addWithoutKey, "silme": deleteWithoutKey} {
		details, _ := envelope.Error.Details.(map[string]any)
		if envelope.Error.Code != apperror.CodeValidationFailed || details[IdempotencyKeyHeader] == nil {
			t.Errorf("%s: anahtarsiz istek 400 olmali: %+v", name, envelope.Error)
		}
	}
	if malformed != http.StatusNotFound {
		t.Errorf("bicimsiz kart kimligi 404 olmali: %d", malformed)
	}
	if h.vault.addCalls() != 0 || len(h.vault.deleted) != 0 {
		t.Error("reddedilen istekler kasaya gitmemeli")
	}
}

func TestCardEndpointsAreAbsentWhenTheVaultIsOff(t *testing.T) {
	// G5 (K1): production'da kart uclari baglanmaz.
	app := New(Deps{Health: fakeReporter{report: healthyReport()}, AccessTokens: testTokens(), Idempotency: testIdempotency(), Logger: silentLogger()})

	for _, method := range []string{http.MethodGet, http.MethodPost} {
		response, err := app.Test(cardRequest(t, method, cardsPath, bearer(t), "anahtar-kapali-0001", cardAddBody))
		if err != nil {
			t.Fatalf("istek: %v", err)
		}
		closeBody(t, response)
		if response.StatusCode != http.StatusNotFound {
			t.Errorf("%s: uclar kapaliyken 404 bekleniyordu: %d", method, response.StatusCode)
		}
	}
}

func TestCardNotFoundIsIndistinguishable(t *testing.T) {
	// #194 ve #148: silme ve ad duzenlemede bicimsiz kimlik kasaya gitmeden 404.
	// Kasanin 404'u (yok, baskasinin, silinmis) x-app-error ayrintisinda kart
	// kimligini tasir; cards.Service onu atar: dordu AYNI zarf. Gercek servis +
	// sahte gRPC istemcisi; ikinci istegin gercekten kasaya gittigi de denetlenir.
	cases := []struct {
		name    string
		method  string
		rpc     string
		body    string
		options func(realCardVault) cardsOptions
	}{
		{"silme", http.MethodDelete, "DeleteCard", "", func(v realCardVault) cardsOptions { return cardsOptions{deleter: v} }},
		{"ad duzenleme", http.MethodPatch, "UpdateCardNickname", cardRenameBody, func(v realCardVault) cardsOptions { return cardsOptions{renamer: v} }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rpc := &vaultRPC{}
			h := newCardsHarness(t, tc.options(realVault(rpc)))

			malformedStatus, malformed := h.statusAndEnvelope(t, cardRequest(t, tc.method, cardPath("crd_bicimsiz"), bearer(t), "anahtar-yok-0001", tc.body))
			if len(rpc.sent) != 0 {
				t.Fatalf("bicimsiz kimlik kasaya gitmemeli: %+v", rpc.sent)
			}
			rpc.fail(codes.NotFound, "Kart bulunamadi", `{"code":"NOT_FOUND","message":"Kart bulunamadi","details":{"cardId":"`+testCardID+`"}}`)
			vaultStatus, vault := h.statusAndEnvelope(t, cardRequest(t, tc.method, cardPath(testCardID), bearer(t), "anahtar-yok-0002", tc.body))

			if want := []vaultCall{{tc.rpc, testUserID, testCardID}}; !reflect.DeepEqual(rpc.sent, want) {
				t.Fatalf("ikinci istek kasaya bir kez gitmeli: %+v", rpc.sent)
			}
			if malformedStatus != http.StatusNotFound || vaultStatus != http.StatusNotFound || malformed.Error == nil || vault.Error == nil {
				t.Fatalf("iki istek de 404 olmali: %d %d", malformedStatus, vaultStatus)
			}
			malformed.Error.RequestID, vault.Error.RequestID = "", ""
			if !reflect.DeepEqual(malformed.Error, vault.Error) || vault.Error.Details != nil {
				t.Errorf("404'ler ayirt edilebiliyor: %+v / %+v", *malformed.Error, *vault.Error)
			}
		})
	}
}
