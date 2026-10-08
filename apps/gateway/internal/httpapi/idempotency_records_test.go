package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/idempotency"
)

// Tekrar korumasi kayitlarinda kisisel veri ve kart verisi aramasi (#194).
//
// Kayit JSON'unda govde base64'tur: ham metinde aranirsa govdedeki sizinti
// GORUNMEZ. Parmak izi ve jeton rastgele onaltiliktir: kisa bir sir ("9183")
// onlarin icinde tesadufen gecer (~1/2500 kosu). Bu yuzden arama govdeyi
// COZER ve bu iki alani disarida birakir; ikisi ayrica denetlenir: parmak izi
// sunucu anahtariyla HMAC'tir (anahtarsiz ozet kart numarasina geri
// cozulebilirdi), jeton yalnizca isleniyor kaydinda vardir.

// randomToken, isleniyor kaydinin jetonu: rastgele onaltilik (uzunluk uretene bagli degil).
var randomToken = regexp.MustCompile(`^[0-9a-f]{32,}$`)

// expectedFingerprint, istegin beklenen parmak izi: test anahtariyla
// HMAC-SHA256(yontem \0 yol \0 govde); govde, ucun politikasi verdiyse maskeli halidir.
func expectedFingerprint(method, path string, body []byte) string {
	mac := hmac.New(sha256.New, testFingerprintKey)
	mac.Write([]byte(method))
	mac.Write([]byte{0})
	mac.Write([]byte(path))
	mac.Write([]byte{0})
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// assertRecordSecrets, kayitlarin aranmayan iki alani: parmak izi beklenen
// anahtarli HMAC, jeton isleniyor kaydinda rastgele, bitmis kayitta bos.
func assertRecordSecrets(t *testing.T, records []idempotency.Record, fingerprint string) {
	t.Helper()
	if len(records) == 0 {
		t.Fatal("kayit yazilmadi")
	}
	for _, record := range records {
		if record.Fingerprint != fingerprint {
			t.Errorf("parmak izi anahtarli HMAC olmali (%s kaydi)", record.State)
		}
		done := record.State == idempotency.StateDone
		if done != (record.Token == "") || (!done && !randomToken.MatchString(record.Token)) {
			t.Errorf("jeton yalnizca isleniyor kaydinda ve rastgele olmali (%s kaydi, %d karakter)", record.State, len(record.Token))
		}
	}
}

// searchableRecords, kayitlarda aranacak metin: cevap govdesi COZULMUS, parmak
// izi ve jeton HARIC (assertRecordSecrets), kaydin diger alanlari JSON olarak.
func searchableRecords(t *testing.T, records []idempotency.Record) string {
	t.Helper()
	var text strings.Builder
	for _, record := range records {
		rest := record
		rest.Fingerprint, rest.Token, rest.Body = "", "", nil
		fields, err := json.Marshal(rest)
		if err != nil {
			t.Fatalf("kayit: %v", err)
		}
		text.Write(fields)
		text.WriteByte('\n')
		text.Write(record.Body)
		text.WriteByte('\n')
	}
	return text.String()
}
