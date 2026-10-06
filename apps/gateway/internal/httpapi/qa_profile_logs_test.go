// QA kara kutu (T11.14 PR 3, #122; madde 6): profil akisinin butun adimlarinda
// kod, numara, sifre, ad ve e-posta gunluge dusmez. Dunya (qaWorld) ve akis
// yardimcilari qa_profile_edit_test.go'da; kisa kodlar rastgele kimlikte tesadufen
// gecebildigi icin maskeli metinde aranir (qa_random_noise_test.go, T11.17 #132).

package httpapi_test

import (
	"net/http"
	"strings"
	"testing"
)

// 6. Gunluk: kod, numara, sifre, ad ve e-posta hicbir satirda yok.
func TestQAProfileFlowLogsNoSecrets(t *testing.T) {
	w := newQAWorld(t)
	oldPhone, newPhone := "+905321110051", "+905551110051"
	oldName, newName := "Gizlikalmali Birinci", "Gizlikalmali Ikinci"
	email := "gizli.adres@example.com"
	w.setPhoneCode("913577")
	w.setEmailCode("642086")

	first := w.register(t, oldPhone, oldName)
	_, second := w.login(t, oldPhone)
	w.login(t, oldPhone)
	w.do(t, qaCall{method: http.MethodPost, path: "/v1/auth/login", body: qaJSON(t, map[string]string{"phone": oldPhone, "password": "Yanlis-Parola-2026"})})
	w.do(t, qaCall{method: http.MethodPatch, path: "/v1/me", auth: first.access, key: qaKey("profil"), body: qaJSON(t, map[string]string{"fullName": newName})})
	w.phoneCode(t, first, newPhone, "Yanlis-Parola-2026")
	w.phoneCode(t, first, newPhone, qaPassword)
	w.phoneVerify(t, first, newPhone, "135799")
	if r := w.phoneVerify(t, first, newPhone, "913577"); r.status != http.StatusOK {
		t.Fatalf("akis tamamlanmali: %d %+v", r.status, r.body.Error)
	}
	w.refresh(t, second)
	w.do(t, qaCall{method: http.MethodPost, path: "/v1/me/email/code", auth: first.access, key: qaKey("eposta"), body: qaJSON(t, map[string]string{"email": email})})
	w.do(t, qaCall{method: http.MethodPost, path: "/v1/me/email/verify", auth: first.access, key: qaKey("eposta"), body: qaJSON(t, map[string]string{"email": email, "code": "111111"})})
	if r := w.do(t, qaCall{method: http.MethodPost, path: "/v1/me/email/verify", auth: first.access, key: qaKey("eposta"), body: qaJSON(t, map[string]string{"email": email, "code": "642086"})}); r.status != http.StatusOK {
		t.Fatalf("e-posta dogrulamasi: %d %+v", r.status, r.body.Error)
	}

	logs := w.logs.String()
	if strings.Count(logs, "\n") < 10 {
		t.Fatalf("gunluk bos gorunuyor (kaydedici bagli mi?): %q", logs)
	}
	secrets := []string{
		qaPassword, "Yanlis-Parola-2026",
		oldPhone, newPhone, strings.TrimPrefix(oldPhone, "+90"), strings.TrimPrefix(newPhone, "+90"),
		oldName, newName, "Gizlikalmali",
		email, "gizli.adres",
	}
	for _, secret := range secrets {
		if strings.Contains(logs, secret) {
			t.Errorf("gunlukte %q var", secret)
		}
	}
	// Kisa kodlar rastgele kimlikte tesadufen gecebilir: maskelenmis metinde aranir.
	masked := qaWithoutRandomNoise(logs)
	for _, code := range []string{"913577", "135799", "642086", "111111"} {
		if strings.Contains(masked, code) {
			t.Errorf("gunlukte kod %q var", code)
		}
	}
}
