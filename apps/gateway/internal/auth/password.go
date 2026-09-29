package auth

import (
	"errors"
	"fmt"

	"golang.org/x/crypto/bcrypt"
)

// DefaultPasswordCost, uretimdeki bcrypt maliyeti (ADR-12). 12: modern bir
// cekirdekte ~200 ms; tek giris icin kabul edilebilir, sizan bir ozetin kaba
// kuvvetle cozulmesi icin pahali. Testler dusuk maliyetle kurar.
const DefaultPasswordCost = 12

// burnSecret, olmayan kullanicida karsilastirilan ozetin kaynagi. Gizli
// DEGILDIR: hicbir sifre bu ozetle "eslesti" sonucuna goturulmez.
const burnSecret = "zamanlama-esitligi-icin-sabit-metin"

// PasswordHasher, sifre ozetleme ve karsilastirma (bcrypt).
type PasswordHasher struct {
	cost int
	// burnHash, olmayan kullanicida AYNI maliyetle karsilastirilan ozet.
	burnHash []byte
}

// NewPasswordHasher, verilen maliyetle kurar; zamanlama ozetini bir kez uretir.
func NewPasswordHasher(cost int) (*PasswordHasher, error) {
	burnHash, err := bcrypt.GenerateFromPassword([]byte(burnSecret), cost)
	if err != nil {
		return nil, fmt.Errorf("zamanlama ozeti uretilemedi: %w", err)
	}
	return &PasswordHasher{cost: cost, burnHash: burnHash}, nil
}

// Hash, sifrenin saklanacak ozeti. Ham sifre hicbir yerde saklanmaz ve loglanmaz.
func (h *PasswordHasher) Hash(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), h.cost)
	if err != nil {
		return "", fmt.Errorf("sifre ozetlenemedi: %w", err)
	}
	return string(hash), nil
}

// Matches, sifre ozetle eslesiyor mu? Ozet bozuksa hata doner (yutulmaz):
// bozuk kayit "yanlis sifre" gibi sessizce gecilmemeli.
func (h *PasswordHasher) Matches(hash, password string) (bool, error) {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	switch {
	case err == nil:
		return true, nil
	case errors.Is(err, bcrypt.ErrMismatchedHashAndPassword):
		return false, nil
	default:
		return false, fmt.Errorf("sifre ozeti karsilastirilamadi: %w", err)
	}
}

// Burn, olmayan kullanicida gercek bir karsilastirmayla AYNI sureyi harcar:
// cevap suresi numaranin kayitli olup olmadigini ele vermesin. Sonuc
// anlamsizdir ve cagiran onu kullanmaz; bool donmesinin sebebi karsilastirmanin
// hata degerini `_ =` ile yutmamaktir (errcheck, check-blank).
func (h *PasswordHasher) Burn(password string) bool {
	return bcrypt.CompareHashAndPassword(h.burnHash, []byte(password)) == nil
}
