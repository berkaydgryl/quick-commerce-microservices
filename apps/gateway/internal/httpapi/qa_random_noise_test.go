// QA (T11.17 #132'nin titrek testi, PM S1): gunlukte KISA sir (6 hane ve alti
// dogrulama kodu) ham metinde aranmaz. Her satirdaki rastgele kimlik
// ("req_8b21ab37ec584a9183af1f3aa53152d7") kodu tesadufen icerebilir ve testi
// yanlis alarmla dusurur. Kural @getir/core/testing withoutRandomNoise ile
// AYNIDIR (Go'da ortak yardimci yok, test icine yazildi):
//
//   - onekli kimlik <onek>_<32 kucuk onaltilik> maskelenir;
//   - degeri her kosuda degisen bilinen alanlar (sure, zaman, surec, makine,
//     port, iz kimlikleri) JSON anahtarindan taninip maskelenir;
//   - GENEL rakam ya da onaltilik dizisi MASKELENMEZ: sizan kod gorunur kalir.
//
// Uzun sirlar (parola, numara, ad, e-posta) tesadufen eslesmez; ham metinde aranir.

package httpapi_test

import (
	"regexp"
	"strings"
	"testing"
)

const (
	qaMaskedID    = "<kimlik>"
	qaMaskedValue = "<rastgele>"
)

var (
	qaPrefixedID       = regexp.MustCompile(`\b[a-z]{2,8}_[0-9a-f]{32}\b`)
	qaRandomFields     = []string{"durationMs", "time", "pid", "hostname", "port", "traceId", "spanId"}
	qaRandomFieldValue = regexp.MustCompile(`"(` + strings.Join(qaRandomFields, "|") + `)":(?:"[^"]*"|-?[0-9][0-9.eE+-]*)`)
)

// qaWithoutRandomNoise, kisa sir aranmadan once rastgele kimlik ve alan
// degerlerini sabitler (withoutRandomNoise'in Go karsiligi).
func qaWithoutRandomNoise(text string) string {
	text = qaPrefixedID.ReplaceAllString(text, qaMaskedID)
	return qaRandomFieldValue.ReplaceAllString(text, `"$1":"`+qaMaskedValue+`"`)
}

// Maskelemenin kendisi: rastgele kimlik ve alanlar gider, sizan kod gorunur kalir.
// Kural genisletilirse (or. "code" alani eklenir) gercek sizinti burada gorunur olur.
func TestQAWithoutRandomNoise(t *testing.T) {
	cases := []struct {
		name, in, want string
	}{
		{
			name: "CI'daki istek kimligi kodu tesadufen icerir: maskelenir",
			in:   `{"requestId":"req_8b21ab37ec584a9183af1f3aa53152d7","durationMs":913577,"time":"2026-10-06T19:35:33.913+03:00"}`,
			want: `{"requestId":"<kimlik>","durationMs":"<rastgele>","time":"<rastgele>"}`,
		},
		{
			name: "sizan kod gorunur kalir",
			in:   `{"code":"913577","msg":"kod 913577 gonderildi"}`,
			want: `{"code":"913577","msg":"kod 913577 gonderildi"}`,
		},
		{
			name: "kimligin yanindaki kod gorunur kalir; oneksiz onaltilik maskelenmez",
			in:   `usr_0123456789abcdef0123456789abcdef 913577 8b21ab37ec584a9183af1f3aa53152d7`,
			want: `<kimlik> 913577 8b21ab37ec584a9183af1f3aa53152d7`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := qaWithoutRandomNoise(tc.in); got != tc.want {
				t.Errorf("\n got: %s\nwant: %s", got, tc.want)
			}
		})
	}
}
