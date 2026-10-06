//go:build integration

// QA kara kutu (T11.15 PR 1, #125; QA incelemesi Q5): adres duzenleme ve silme
// uclari HTTP uzerinden (httpapi.New) GERCEK Mongo deposuyla (kendi konteyneri,
// qaRaceMongo). Backend depo yarislarini depo duzeyinde, uclari bellek deposuyla
// sinar; burada ikisi birlikte:
//
//   - PUT ve DELETE tekrar korumasi: ayni anahtar ayni cevap (Idempotent-Replayed),
//     ayni anahtar baska adres yolunda 409; silinmis adrese yeni anahtar 404;
//   - sahiplik: baskasinin adresi PUT ve DELETE'te 404, sahibinin defteri degismez;
//   - ayni ada eszamanli 16 yeniden adlandirma: tek kazanan, digerleri {title};
//   - silme ile guncelleme yarisi (20 tur): silinen adres geri gelmez;
//   - dolu defter (10): guncelleme serbest, 11. ekleme {addresses};
//   - ad 40 karakter gecer, 41 {title}; kirpilir.
//
// Calistirma (Docker gerekir): go test -tags integration -run TestQAAddress ./internal/authstore/
package authstore_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"golang.org/x/crypto/bcrypt"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/authstore"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/httpapi"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

const qaAddrConcurrency = 16

// Sozlesmedeki sinirlar (@getir/contracts SAVED_ADDRESSES_MAX, ADDRESS_TITLE_MAX_LENGTH):
// kara kutu test kodun sabitinden degil sozlesmeden okur.
const (
	qaAddrBookMax  = 10
	qaAddrTitleMax = 40
)

func qaAddrApp(t *testing.T, db *mongo.Database) *fiber.App {
	t.Helper()
	passwords, err := auth.NewPasswordHasher(bcrypt.MinCost)
	if err != nil {
		t.Fatalf("sifre ozetleyici: %v", err)
	}
	tokens := auth.NewTokens([]byte("yalnizca-qa-testi-icin-imza-sirri-32-bayttan-uzun"), time.Hour, time.Now)
	identity := auth.NewService(auth.Deps{
		Users: authstore.NewMongoUsers(db), Sessions: authstore.NewMongoSessions(db), Passwords: passwords,
		Tokens: tokens, RefreshTTL: 14 * 24 * time.Hour, Now: time.Now,
	})
	return httpapi.New(httpapi.Deps{
		UserRegistrar: identity, AddressBook: identity, AddressAdder: identity,
		AddressUpdater: identity, AddressDeleter: identity, AccessTokens: tokens,
		Idempotency: httpapi.Idempotency{Store: idempotency.NewMemory(time.Now), FingerprintKey: []byte("qa-parmak-izi"), TTL: time.Hour},
		Logger:      qaRaceLogger(),
	})
}

type qaAddrReply struct {
	status   int
	replayed bool
	code     apperror.Code
	details  map[string]any
	items    []qaAddrEntry
	raw      string
}

type qaAddrEntry struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Line  string `json:"line"`
}

func qaAddrCall(t *testing.T, app *fiber.App, method, path, access, key, body string) qaAddrReply {
	t.Helper()
	request := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	if key != "" {
		request.Header.Set(httpapi.IdempotencyKeyHeader, key)
	}
	if access != "" {
		request.Header.Set(fiber.HeaderAuthorization, "Bearer "+access)
	}
	response, err := app.Test(request, fiber.TestConfig{Timeout: 30 * time.Second})
	if err != nil {
		t.Errorf("istek basarisiz: %v", err)
		return qaAddrReply{}
	}
	raw, readErr := io.ReadAll(response.Body)
	if closeErr := response.Body.Close(); closeErr != nil {
		t.Errorf("govde kapatilamadi: %v", closeErr)
	}
	if readErr != nil {
		t.Errorf("govde okunamadi: %v", readErr)
	}
	var envelope struct {
		Data *struct {
			Items       []qaAddrEntry `json:"items"`
			AccessToken string        `json:"accessToken"`
		} `json:"data"`
		Error *struct {
			Code    apperror.Code  `json:"code"`
			Details map[string]any `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Errorf("zarf cozulemedi: %v %s", err, raw)
	}
	reply := qaAddrReply{status: response.StatusCode, replayed: response.Header.Get(httpapi.IdempotentReplayedHeader) != "", raw: string(raw)}
	if envelope.Data != nil {
		reply.items = envelope.Data.Items
	}
	if envelope.Error != nil {
		reply.code, reply.details = envelope.Error.Code, envelope.Error.Details
	}
	return reply
}

func qaAddrKey() string { return "qa-" + ids.New("k") }

func qaAddrBody(title string, index int) string {
	return fmt.Sprintf(`{"title":%q,"kind":"HOME","line":"Moda Cad. No:%d","location":{"lat":40.98,"lng":29.02}}`, title, index)
}

// qaAddrUser, kayitli hesap ve verilen adlarla adres defteri; erisim jetonu ve defter.
func qaAddrUser(t *testing.T, app *fiber.App, phone string, titles ...string) (string, []qaAddrEntry) {
	t.Helper()
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/v1/auth/register",
		strings.NewReader(`{"phone":"`+phone+`","password":"Gizli-Parola-2026","fullName":"Adres Hesabi"}`))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	request.Header.Set(httpapi.IdempotencyKeyHeader, qaAddrKey())
	response, err := app.Test(request, fiber.TestConfig{Timeout: 30 * time.Second})
	if err != nil {
		t.Fatalf("kayit: %v", err)
	}
	var grant struct {
		Data auth.Grant `json:"data"`
	}
	decodeErr := json.NewDecoder(response.Body).Decode(&grant)
	if closeErr := response.Body.Close(); closeErr != nil {
		t.Errorf("govde kapatilamadi: %v", closeErr)
	}
	if response.StatusCode != http.StatusCreated || decodeErr != nil {
		t.Fatalf("kayit: %d %v", response.StatusCode, decodeErr)
	}
	var book []qaAddrEntry
	for index, title := range titles {
		reply := qaAddrCall(t, app, http.MethodPost, "/v1/me/addresses", grant.Data.AccessToken, qaAddrKey(), qaAddrBody(title, index))
		if reply.status != http.StatusCreated {
			t.Fatalf("adres %q: %d %s", title, reply.status, reply.raw)
		}
		book = reply.items
	}
	return grant.Data.AccessToken, book
}

func TestQAAddressReplayAndOwnershipOverHTTPOnMongo(t *testing.T) {
	app := qaAddrApp(t, qaRaceMongo(t))
	owner, book := qaAddrUser(t, app, "+905321260001", "Ev", "İş", "Yazlık")
	stranger, _ := qaAddrUser(t, app, "+905321260002", "Ev")
	home, work := book[0], book[1]

	key := qaAddrKey()
	first := qaAddrCall(t, app, http.MethodPut, "/v1/me/addresses/"+home.ID, owner, key, qaAddrBody("Evim", 9))
	again := qaAddrCall(t, app, http.MethodPut, "/v1/me/addresses/"+home.ID, owner, key, qaAddrBody("Evim", 9))
	otherPath := qaAddrCall(t, app, http.MethodPut, "/v1/me/addresses/"+work.ID, owner, key, qaAddrBody("Evim", 9))
	if first.status != http.StatusOK || again.status != http.StatusOK || !again.replayed || again.raw != first.raw {
		t.Errorf("PUT ayni anahtar ayni cevap ve tekrar basligi: %d %d %v", first.status, again.status, again.replayed)
	}
	if otherPath.status != http.StatusConflict {
		t.Errorf("ayni anahtar baska adres yolunda 409: %d %s", otherPath.status, otherPath.raw)
	}

	deleteKey := qaAddrKey()
	deleted := qaAddrCall(t, app, http.MethodDelete, "/v1/me/addresses/"+work.ID, owner, deleteKey, "")
	replayed := qaAddrCall(t, app, http.MethodDelete, "/v1/me/addresses/"+work.ID, owner, deleteKey, "")
	gone := qaAddrCall(t, app, http.MethodDelete, "/v1/me/addresses/"+work.ID, owner, qaAddrKey(), "")
	if deleted.status != http.StatusOK || len(deleted.items) != 2 || !replayed.replayed || replayed.raw != deleted.raw {
		t.Errorf("DELETE ayni anahtar ilk cevabi tekrar etmeli: %d %d %v", deleted.status, replayed.status, replayed.replayed)
	}
	if gone.status != http.StatusNotFound {
		t.Errorf("silinmis adrese yeni anahtar 404: %d", gone.status)
	}

	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		body := ""
		if method == http.MethodPut {
			body = qaAddrBody("Ele geçirildi", 1)
		}
		if reply := qaAddrCall(t, app, method, "/v1/me/addresses/"+home.ID, stranger, qaAddrKey(), body); reply.status != http.StatusNotFound || reply.code != apperror.CodeNotFound {
			t.Errorf("%s baskasinin adresi 404 NOT_FOUND: %d %s", method, reply.status, reply.raw)
		}
	}
	after := qaAddrCall(t, app, http.MethodGet, "/v1/me/addresses", owner, "", "")
	if len(after.items) != 2 || after.items[0].Title != "Evim" || after.items[0].ID != home.ID {
		t.Errorf("sahibin defteri yabancinin isteginden etkilenmemeli: %+v", after.items)
	}
}

func TestQAAddressConcurrentRenamesAndDeleteUpdateRacesOverHTTPOnMongo(t *testing.T) {
	app := qaAddrApp(t, qaRaceMongo(t))
	titles := make([]string, 0, qaAddrConcurrency)
	for index := range qaAddrConcurrency / 2 {
		titles = append(titles, fmt.Sprintf("Adres %d", index))
	}
	access, book := qaAddrUser(t, app, "+905321270001", titles...)

	t.Run("ayni ada eszamanli yeniden adlandirma: tek kazanan", func(t *testing.T) {
		replies := make([]qaAddrReply, qaAddrConcurrency)
		start := make(chan struct{})
		var wg sync.WaitGroup
		for index := range qaAddrConcurrency {
			target := book[index%len(book)]
			wg.Go(func() {
				<-start
				replies[index] = qaAddrCall(t, app, http.MethodPut, "/v1/me/addresses/"+target.ID, access, qaAddrKey(), qaAddrBody("Yeni Ad", index))
			})
		}
		close(start)
		wg.Wait()
		winners := map[string]bool{}
		for index, reply := range replies {
			switch {
			case reply.status == http.StatusOK:
				winners[book[index%len(book)].ID] = true
			case reply.status == http.StatusBadRequest && reply.details["title"] != nil:
			default:
				t.Errorf("beklenmeyen cevap: %d %s", reply.status, reply.raw)
			}
		}
		final := qaAddrCall(t, app, http.MethodGet, "/v1/me/addresses", access, "", "")
		named := 0
		for _, entry := range final.items {
			if entry.Title == "Yeni Ad" {
				named++
			}
		}
		if len(winners) != 1 || named != 1 {
			t.Errorf("tek adres kazanmali: kazanan adres %d, ad tasiyan %d", len(winners), named)
		}
	})

	t.Run("silme ile guncelleme yarisi: silinen adres geri gelmez", func(t *testing.T) {
		for round := range 20 {
			current := qaAddrCall(t, app, http.MethodGet, "/v1/me/addresses", access, "", "")
			if len(current.items) == 0 {
				t.Fatal("defter bosaldi")
			}
			victim := current.items[len(current.items)-1]
			var put, del qaAddrReply
			start := make(chan struct{})
			var wg sync.WaitGroup
			wg.Go(func() {
				<-start
				put = qaAddrCall(t, app, http.MethodPut, "/v1/me/addresses/"+victim.ID, access, qaAddrKey(), qaAddrBody(fmt.Sprintf("Yarış %d", round), round))
			})
			wg.Go(func() {
				<-start
				del = qaAddrCall(t, app, http.MethodDelete, "/v1/me/addresses/"+victim.ID, access, qaAddrKey(), "")
			})
			close(start)
			wg.Wait()
			final := qaAddrCall(t, app, http.MethodGet, "/v1/me/addresses", access, "", "")
			for _, entry := range final.items {
				if entry.ID == victim.ID {
					t.Fatalf("tur %d: silinen adres geri geldi (PUT %d, DELETE %d)", round, put.status, del.status)
				}
			}
			if del.status != http.StatusOK || (put.status != http.StatusOK && put.status != http.StatusNotFound) {
				t.Errorf("tur %d: DELETE 200, PUT 200 ya da 404 beklenirdi: %d %d", round, del.status, put.status)
			}
			if len(final.items) == 0 {
				break
			}
			// Bir sonraki tura yeni kurban: defteri dolu tut.
			if reply := qaAddrCall(t, app, http.MethodPost, "/v1/me/addresses", access, qaAddrKey(), qaAddrBody(fmt.Sprintf("Ek %d", round), round)); reply.status != http.StatusCreated {
				t.Fatalf("tur %d ekleme: %d %s", round, reply.status, reply.raw)
			}
		}
	})
}

func TestQAAddressBookLimitAndTitleLengthOverHTTPOnMongo(t *testing.T) {
	app := qaAddrApp(t, qaRaceMongo(t))
	titles := make([]string, 0, qaAddrBookMax)
	for index := range qaAddrBookMax {
		titles = append(titles, fmt.Sprintf("Adres %d", index))
	}
	access, book := qaAddrUser(t, app, "+905321280001", titles...)
	if len(book) != qaAddrBookMax {
		t.Fatalf("dolu defter kurulamadi: %d", len(book))
	}

	update := qaAddrCall(t, app, http.MethodPut, "/v1/me/addresses/"+book[0].ID, access, qaAddrKey(), qaAddrBody("Dolu defterde yeni ad", 1))
	extra := qaAddrCall(t, app, http.MethodPost, "/v1/me/addresses", access, qaAddrKey(), qaAddrBody("Fazla", 1))
	exact := strings.Repeat("ş", qaAddrTitleMax)
	fits := qaAddrCall(t, app, http.MethodPut, "/v1/me/addresses/"+book[1].ID, access, qaAddrKey(), qaAddrBody("  "+exact+"  ", 2))
	tooLong := qaAddrCall(t, app, http.MethodPut, "/v1/me/addresses/"+book[2].ID, access, qaAddrKey(), qaAddrBody(exact+"x", 3))

	if update.status != http.StatusOK {
		t.Errorf("dolu defterde guncelleme serbest: %d %s", update.status, update.raw)
	}
	if extra.status != http.StatusBadRequest || extra.details["addresses"] == nil {
		t.Errorf("11. ekleme {addresses}: %d %s", extra.status, extra.raw)
	}
	if fits.status != http.StatusOK || fits.items[1].Title != exact {
		t.Errorf("40 karakter (kirpilinca) gecmeli: %d %s", fits.status, fits.raw)
	}
	if tooLong.status != http.StatusBadRequest || tooLong.details["title"] == nil {
		t.Errorf("41 karakter {title}: %d %s", tooLong.status, tooLong.raw)
	}
}
