// Package ids, kaynak kimliklerinin bicimidir: "<onek>_" + 32 kucuk onaltilik
// karakter (16 rastgele bayt). Kaynak @getir/core id.ts (ID_PREFIX,
// ID_BODY_PATTERN); Node servisleri kimligi ayni bicimde uretir.
//
// NEDEN TEK PAKET: korelasyon kimligi (req), kullanici (usr), oturum (ses) ve
// cihaz (dvc) ve kayitli adres (adr) ayni bicimi kullanir; bicim iki yerde
// yazilsaydi bir gun ayrisirdi.
package ids

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
)

// Onekler (@getir/core id.ts ID_PREFIX).
const (
	Request = "req"
	User    = "usr"
	Session = "ses"
	Device  = "dvc"
	// Address, kayitli adres (T11.15).
	Address = "adr"
)

// bodyBytes, kimlik govdesinin rastgele bayt sayisi: 16 bayt = 32 onaltilik.
const bodyBytes = 16

// New, verilen onekle yeni bir kimlik uretir.
func New(prefix string) string {
	return prefix + "_" + hex.EncodeToString(RandomBytes(bodyBytes))
}

// Valid, degerin verilen onekli gecerli bir kimlik olup olmadigini soyler.
func Valid(prefix, id string) bool {
	body, found := cutPrefix(id, prefix+"_")
	if !found || len(body) != 2*bodyBytes {
		return false
	}
	for _, char := range body {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

// RandomBytes, kriptografik olarak guvenli n bayt doner.
//
// Go 1.24'ten beri crypto/rand.Read hata DONDURMEZ; kaynak okunamazsa program
// kendisi durur (paket belgesi). Kontrol yine de yazilir: "hata yutulmaz"
// kurali istisnasiz uygulansin.
func RandomBytes(n int) []byte {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Errorf("rastgele kaynak okunamadi: %w", err))
	}
	return buf
}

func cutPrefix(value, prefix string) (string, bool) {
	if len(value) < len(prefix) || value[:len(prefix)] != prefix {
		return "", false
	}
	return value[len(prefix):], true
}
