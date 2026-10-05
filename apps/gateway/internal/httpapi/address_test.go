package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// Adres ekleme (T11.8), duzenleme ve silme (T11.15) gercek servisle sinanir:
// kayit -> adres -> defter.

// testAddressID, sahte servisle sinanan yol kimligi (bicimce gecerli).
const testAddressID = "adr_0123456789abcdef0123456789abcdef"

const validAddressBody = `{"title":"Ev","kind":"HOME","line":"Acıbadem, 34660 Üsküdar/İstanbul, Türkiye",` +
	`"location":{"lat":40.9885,"lng":29.027},"building":"19C3","floor":"3","apartment":"12","note":"Zil bozuk"}`

// signedUp, yeni bir hesap acar; erisim jetonlu Authorization degerini doner.
func signedUp(t *testing.T, app *fiber.App) string {
	t.Helper()
	status, envelope := send(t, app, registerRequest(t, registerBodyOf(testPhone, testPassword, testFullName)))
	if status != http.StatusCreated {
		t.Fatalf("kayit 201 donmeli: %d %+v", status, envelope)
	}
	return bearerScheme + " " + dataOf[auth.Grant](t, envelope).AccessToken
}

func addAddressRequest(t *testing.T, authorization, key, body string) *http.Request {
	t.Helper()
	return jsonRequest(t, http.MethodPost, "/v1/me/addresses", body, map[string]string{
		fiber.HeaderAuthorization: authorization, IdempotencyKeyHeader: key,
	})
}

func TestAddAddressReturnsTheUpdatedBook(t *testing.T) {
	app := authApp(t, silentLogger())
	authorization := signedUp(t, app)

	status, header, envelope := exchange(t, app, addAddressRequest(t, authorization, "adres-0001", validAddressBody))

	if status != http.StatusCreated || header.Get(fiber.HeaderCacheControl) != noStore {
		t.Fatalf("201 ve no-store bekleniyordu: %d %q %+v", status, header.Get(fiber.HeaderCacheControl), envelope)
	}
	data, err := json.Marshal(envelope.Data)
	if err != nil {
		t.Fatalf("data yeniden yazilamadi: %v", err)
	}
	// JSON nesnesi cozulup yeniden yazilinca anahtarlar alfabetik siralanir.
	// Kimlik (T11.15) rastgeledir: bicimi denetlenir, karsilastirmada yerine konur.
	id := dataOf[auth.AddressBook](t, envelope).Items[0].ID
	if !ids.Valid(ids.Address, id) {
		t.Fatalf("yeni adres adr_ kimligi tasimali: %q", id)
	}
	want := `{"items":[{"apartment":"12","building":"19C3","floor":"3","id":"` + id + `","kind":"HOME","line":"Acıbadem, 34660 Üsküdar/İstanbul, Türkiye",` +
		`"location":{"lat":40.9885,"lng":29.027},"note":"Zil bozuk","title":"Ev"}]}`
	if string(data) != want {
		t.Errorf("cevap guncel defter olmali:\n got %s\nwant %s", data, want)
	}

	// Okuma ayni defteri doner: web kaydettikten sonra adresi listede bulur.
	status, envelope = send(t, app, jsonRequest(t, http.MethodGet, "/v1/me/addresses", "", map[string]string{fiber.HeaderAuthorization: authorization}))
	if book := dataOf[auth.AddressBook](t, envelope); status != http.StatusOK || len(book.Items) != 1 || book.Items[0].Title != "Ev" {
		t.Errorf("eklenen adres defterde olmali: %d %+v", status, book)
	}
}

func TestAddAddressReplaysSameKeyAndRejectsTakenTitle(t *testing.T) {
	app := authApp(t, silentLogger())
	authorization := signedUp(t, app)
	send(t, app, addAddressRequest(t, authorization, "adres-0001", validAddressBody))

	// Ayni anahtar + ayni govde: ag kopup tekrar gonderilen istek (ADR-08);
	// ilk cevap doner, adres iki kez yazilmaz.
	status, envelope := send(t, app, addAddressRequest(t, authorization, "adres-0001", validAddressBody))
	if book := dataOf[auth.AddressBook](t, envelope); status != http.StatusCreated || len(book.Items) != 1 {
		t.Errorf("tekrar ilk cevabi donmeli: %d %+v", status, book)
	}

	// Yeni anahtarla ayni ad: alan hatasi.
	status, envelope = send(t, app, addAddressRequest(t, authorization, "adres-0002", validAddressBody))
	if status != http.StatusBadRequest || envelope.Error.Code != apperror.CodeValidationFailed ||
		detailsOf(t, envelope)[auth.FieldTitle] != "Bu adla kayıtlı bir adresin var" {
		t.Errorf("ayni adla ikinci adres 400 ve baslik ayrintisi donmeli: %d %+v", status, envelope)
	}
}

func TestAddAddressCollectsEveryProblemAtOnce(t *testing.T) {
	app := authApp(t, silentLogger())
	authorization := signedUp(t, app)
	body := `{"title":" ","kind":"EV","line":"","location":{"lat":95}}`

	status, envelope := send(t, app, addAddressRequest(t, authorization, "", body))

	details := detailsOf(t, envelope)
	for _, field := range []string{IdempotencyKeyHeader, auth.FieldTitle, auth.FieldKind, auth.FieldLine, "location.lng"} {
		if details[field] == nil {
			t.Errorf("%s ayrintisi bekleniyordu: %+v", field, details)
		}
	}
	// Konum gonderildi: sorun eksik koordinatta, "location zorunlu" yazilmaz.
	if details[auth.FieldLocation] != nil {
		t.Errorf("gonderilen konum icin zorunlu sebebi yazilmamali: %+v", details)
	}
	if status != http.StatusBadRequest || envelope.Error.Code != apperror.CodeValidationFailed {
		t.Errorf("400 VALIDATION_FAILED bekleniyordu: %d %+v", status, envelope)
	}
}

func TestAddAddressWithoutLocationSaysRequired(t *testing.T) {
	app := authApp(t, silentLogger())
	authorization := signedUp(t, app)

	status, envelope := send(t, app, addAddressRequest(t, authorization, "adres-0001", `{"title":"Ev","kind":"HOME","line":"Moda"}`))

	if status != http.StatusBadRequest || detailsOf(t, envelope)[auth.FieldLocation] != requiredReason {
		t.Errorf("konumsuz adres 400 ve location zorunlu donmeli: %d %+v", status, envelope)
	}
}

func TestAddAddressRejectsUnknownField(t *testing.T) {
	// Sessizce yok sayilsaydi istemci (ornegin "isDefault") kaydedildigini sanirdi.
	app := authApp(t, silentLogger())
	authorization := signedUp(t, app)
	body := `{"title":"Ev","kind":"HOME","line":"Moda","location":{"lat":41,"lng":29},"isDefault":true}`

	status, envelope := send(t, app, addAddressRequest(t, authorization, "adres-0001", body))

	if status != http.StatusBadRequest || detailsOf(t, envelope)["isDefault"] != unknownFieldReason {
		t.Errorf("bilinmeyen alan 400 donmeli: %d %+v", status, envelope)
	}
}

func TestAddAddressReceivesUserFromToken(t *testing.T) {
	profiles := &fakeProfiles{}
	app := protectedApp(&fakeOrders{}, profiles, silentLogger())

	status, envelope := send(t, app, orderRequest(t, http.MethodPost, "/v1/me/addresses", validAddressBody, nil))

	if status != http.StatusCreated || profiles.userID != testUserID {
		t.Errorf("201 ve jetondaki kullanici bekleniyordu: %d %q %+v", status, profiles.userID, envelope)
	}
}

// addressRequest, adres yoluna anahtarli istek (T11.15).
func addressRequest(t *testing.T, method, authorization, addressID, key, body string) *http.Request {
	t.Helper()
	return jsonRequest(t, method, "/v1/me/addresses/"+addressID, body, map[string]string{
		fiber.HeaderAuthorization: authorization, IdempotencyKeyHeader: key,
	})
}

// addedBook, yeni hesaba verilen adlarla adres ekler; son defteri doner.
func addedBook(t *testing.T, app *fiber.App, authorization string, titles ...string) auth.AddressBook {
	t.Helper()
	var book auth.AddressBook
	for i, title := range titles {
		body := strings.Replace(validAddressBody, `"title":"Ev"`, `"title":"`+title+`"`, 1)
		status, envelope := send(t, app, addAddressRequest(t, authorization, fmt.Sprintf("adres-ek-%04d", i+1), body))
		if status != http.StatusCreated {
			t.Fatalf("%s eklenemedi: %d %+v", title, status, envelope)
		}
		book = dataOf[auth.AddressBook](t, envelope)
	}
	return book
}

func TestUpdateAddressReplacesTheEntryAndReturnsTheBook(t *testing.T) {
	app := authApp(t, silentLogger())
	authorization := signedUp(t, app)
	book := addedBook(t, app, authorization, "Ev", "İş")
	body := `{"title":"Ofis","kind":"WORK","line":"Levent, 34330 Beşiktaş/İstanbul, Türkiye","location":{"lat":41.08,"lng":29.01}}`

	status, header, envelope := exchange(t, app, addressRequest(t, http.MethodPut, authorization, book.Items[1].ID, "adres-duz-0001", body))

	updated := dataOf[auth.AddressBook](t, envelope)
	if status != http.StatusOK || header.Get(fiber.HeaderCacheControl) != noStore || len(updated.Items) != 2 {
		t.Fatalf("200, no-store ve guncel defter bekleniyordu: %d %+v", status, envelope)
	}
	got := updated.Items[1]
	if got.ID != book.Items[1].ID || got.Title != "Ofis" || got.Kind != auth.AddressKindWork || got.Building != "" || got.Note != "" || updated.Items[0] != book.Items[0] {
		t.Errorf("yalnizca hedef, tam govdeyle degismeli (gonderilmeyen alan silinir): %+v", updated)
	}
	status, envelope = send(t, app, jsonRequest(t, http.MethodGet, "/v1/me/addresses", "", map[string]string{fiber.HeaderAuthorization: authorization}))
	if read := dataOf[auth.AddressBook](t, envelope); status != http.StatusOK || read.Items[1] != got {
		t.Errorf("okuma guncel adresi donmeli: %d %+v", status, read)
	}
}

func TestUpdateAddressRulesAndErrors(t *testing.T) {
	app := authApp(t, silentLogger())
	authorization := signedUp(t, app)
	book := addedBook(t, app, authorization, "Ev", "İş")
	target := book.Items[0].ID
	takenBody := strings.Replace(validAddressBody, `"title":"Ev"`, `"title":"İş"`, 1)

	status, envelope := send(t, app, addressRequest(t, http.MethodPut, authorization, target, "adres-duz-0001", takenBody))
	if status != http.StatusBadRequest || detailsOf(t, envelope)[auth.FieldTitle] != "Bu adla kayıtlı bir adresin var" {
		t.Errorf("baska adresin adi 400 ve baslik ayrintisi: %d %+v", status, envelope)
	}
	for i, id := range []string{ids.New(ids.Address), "Ev", "usr_0123456789abcdef0123456789abcdef"} {
		status, envelope = send(t, app, addressRequest(t, http.MethodPut, authorization, id, fmt.Sprintf("adres-yok-%04d", i), validAddressBody))
		if status != http.StatusNotFound || envelope.Error.Code != apperror.CodeNotFound {
			t.Errorf("%q: defterde olmayan kimlik 404 NOT_FOUND: %d %+v", id, status, envelope)
		}
	}
	status, envelope = send(t, app, addressRequest(t, http.MethodPut, authorization, target, "", `{"title":" ","kind":"EV","line":"","location":{"lat":95},"isDefault":true}`))
	details := detailsOf(t, envelope)
	if status != http.StatusBadRequest || details["isDefault"] != unknownFieldReason {
		t.Errorf("bilinmeyen alan once reddedilir (eklemedeki gibi): %d %+v", status, envelope)
	}
	status, envelope = send(t, app, addressRequest(t, http.MethodPut, authorization, target, "", `{"title":" ","kind":"EV","line":"","location":{"lat":95}}`))
	details = detailsOf(t, envelope)
	for _, field := range []string{IdempotencyKeyHeader, auth.FieldTitle, auth.FieldKind, auth.FieldLine, "location.lng"} {
		if status != http.StatusBadRequest || details[field] == nil {
			t.Errorf("%s ayrintisi bekleniyordu (eklemeyle ayni kurallar): %d %+v", field, status, details)
		}
	}
}

func TestDeleteAddressReturnsTheBookAndReplaysSameKey(t *testing.T) {
	app := authApp(t, silentLogger())
	authorization := signedUp(t, app)
	book := addedBook(t, app, authorization, "Ev", "İş", "Annem")

	status, header, envelope := exchange(t, app, addressRequest(t, http.MethodDelete, authorization, book.Items[1].ID, "adres-sil-0001", ""))
	left := dataOf[auth.AddressBook](t, envelope)
	if status != http.StatusOK || header.Get(fiber.HeaderCacheControl) != noStore || len(left.Items) != 2 ||
		left.Items[0] != book.Items[0] || left.Items[1] != book.Items[2] {
		t.Fatalf("200, no-store ve hedefsiz defter bekleniyordu: %d %+v", status, envelope)
	}

	// Ayni anahtar: ag kopup tekrar gonderilen silme (ADR-08) ilk cevabi alir.
	status, envelope = send(t, app, addressRequest(t, http.MethodDelete, authorization, book.Items[1].ID, "adres-sil-0001", ""))
	if replay := dataOf[auth.AddressBook](t, envelope); status != http.StatusOK || len(replay.Items) != 2 {
		t.Errorf("tekrar ilk cevabi donmeli: %d %+v", status, envelope)
	}
	// Yeni anahtar: adres artik yok.
	status, envelope = send(t, app, addressRequest(t, http.MethodDelete, authorization, book.Items[1].ID, "adres-sil-0002", ""))
	if status != http.StatusNotFound || envelope.Error.Code != apperror.CodeNotFound {
		t.Errorf("silinmis adres 404 NOT_FOUND: %d %+v", status, envelope)
	}
	status, envelope = send(t, app, addressRequest(t, http.MethodDelete, authorization, book.Items[0].ID, "", ""))
	if status != http.StatusBadRequest || detailsOf(t, envelope)[IdempotencyKeyHeader] == nil {
		t.Errorf("silme anahtar ister: %d %+v", status, envelope)
	}
}

func TestAddressChangesReceiveUserAndIDFromTheRequest(t *testing.T) {
	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		profiles := &fakeProfiles{}
		app := protectedApp(&fakeOrders{}, profiles, silentLogger())
		body := ""
		if method == http.MethodPut {
			body = validAddressBody
		}

		status, envelope := send(t, app, orderRequest(t, method, "/v1/me/addresses/"+testAddressID, body, nil))

		if status != http.StatusOK || profiles.userID != testUserID || profiles.addressID != testAddressID {
			t.Errorf("%s: 200, jetondaki kullanici ve yoldaki kimlik bekleniyordu: %d %q %q %+v", method, status, profiles.userID, profiles.addressID, envelope)
		}
	}
}
