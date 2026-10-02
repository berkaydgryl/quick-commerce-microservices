package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// Adres ekleme (T11.8) gercek servisle sinanir: kayit -> adres -> defter.

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
	want := `{"items":[{"apartment":"12","building":"19C3","floor":"3","kind":"HOME","line":"Acıbadem, 34660 Üsküdar/İstanbul, Türkiye",` +
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
