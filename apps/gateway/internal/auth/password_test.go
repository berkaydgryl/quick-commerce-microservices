package auth

import (
	"errors"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func testHasher(t *testing.T) *PasswordHasher {
	t.Helper()
	hasher, err := NewPasswordHasher(bcrypt.MinCost)
	if err != nil {
		t.Fatalf("ozetleyici kurulamadi: %v", err)
	}
	return hasher
}

func TestPasswordHashMatchesOnlyItsPassword(t *testing.T) {
	hasher := testHasher(t)

	hash, err := hasher.Hash("Gizli-Parola-2026")
	if err != nil {
		t.Fatalf("ozetlenemedi: %v", err)
	}
	if strings.Contains(hash, "Gizli-Parola-2026") {
		t.Fatal("ozet ham sifreyi icermemeli")
	}

	if matches, err := hasher.Matches(hash, "Gizli-Parola-2026"); !matches || err != nil {
		t.Errorf("dogru sifre eslesmeli: %v %v", matches, err)
	}
	if matches, err := hasher.Matches(hash, "Yanlis-Parola-2026"); matches || err != nil {
		t.Errorf("yanlis sifre hatasiz false donmeli: %v %v", matches, err)
	}
}

func TestCorruptHashIsAnErrorNotAMismatch(t *testing.T) {
	// Bozuk kayit "yanlis sifre" gibi sessizce gecilirse sorun hic fark edilmez.
	if _, err := testHasher(t).Matches("bozuk-ozet", "Gizli-Parola-2026"); err == nil {
		t.Error("bozuk ozet hata donmeliydi")
	}
}

func TestHashRefusesPasswordsBcryptWouldTruncate(t *testing.T) {
	// Kural katmani 72 bayti gecen sifreyi zaten reddeder (rules.go); bu test
	// alttaki kutuphanenin de sessizce kirpmadigini sabitler.
	_, err := testHasher(t).Hash(strings.Repeat("a", passwordMaxBytes+1))

	if !errors.Is(err, bcrypt.ErrPasswordTooLong) {
		t.Errorf("73 baytlik sifre reddedilmeliydi: %v", err)
	}
}

func TestBurnNeverMatchesARealPassword(t *testing.T) {
	if testHasher(t).Burn("Gizli-Parola-2026") {
		t.Error("zamanlama karsilastirmasi eslesme uretmemeli")
	}
}

func TestInvalidCostIsRejected(t *testing.T) {
	if _, err := NewPasswordHasher(bcrypt.MaxCost + 1); err == nil {
		t.Error("gecersiz maliyet acilista reddedilmeliydi")
	}
}
