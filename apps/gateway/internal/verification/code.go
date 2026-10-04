package verification

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
)

// codeSpace, 6 rakamli kodlarin sayisi (10^6).
var codeSpace = big.NewInt(1_000_000)

// NewCode, kriptografik rastgele 6 rakam (bastaki sifirlar korunur: "042137").
// Rastgele kaynak bozulursa surecin devam etmesi anlamsizdir (ids.RandomBytes
// ile ayni kural).
func NewCode() string {
	n, err := rand.Int(rand.Reader, codeSpace)
	if err != nil {
		panic(fmt.Sprintf("kod uretilemedi: %v", err))
	}
	return fmt.Sprintf("%0*d", codeDigits, n.Int64())
}

// Hasher, kodun saklanan ozeti: HMAC-SHA256(anahtar, kullanici, adres, kod).
//
// NEDEN DUZ SHA-256 DEGIL: kod yalnizca 10^6 ihtimaldir; duz ozet Redis'e
// bakabilen biri icin bir saniyede tersine cevrilirdi. Anahtar gateway'in
// sirrindan kanal basina ayri etiketle turetilir (cmd/gateway), Redis'te durmaz.
// Kullanici ve adres (e-posta ya da numara) ozete girer: ayni kod baska hesapta
// ya da baska adreste eslesmez.
type Hasher struct {
	key []byte
}

// NewHasher, anahtarla kurar.
func NewHasher(key []byte) Hasher {
	return Hasher{key: key}
}

// Hash, ozetin onaltilik metni.
func (h Hasher) Hash(userID, address, code string) string {
	mac := hmac.New(sha256.New, h.key)
	// Ayirici NUL: hicbir parca onu tasiyamaz, parcalar kaydirilamaz.
	mac.Write([]byte(userID + "\x00" + address + "\x00" + code))
	return hex.EncodeToString(mac.Sum(nil))
}
