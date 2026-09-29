package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"time"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/ids"
)

// User, kullanici kaydi (users koleksiyonu; sahibi gateway, ADR-05).
type User struct {
	ID           string
	Phone        string
	PasswordHash string
	FullName     string
	CreatedAt    time.Time
}

// Profile, istemciye giden kullanici (@getir/contracts userProfileSchema).
// Sifre ozeti gibi alanlar BILEREK yoktur: tip, sizintiyi derleme aninda onler.
type Profile struct {
	ID       string `json:"id"`
	Phone    string `json:"phone"`
	FullName string `json:"fullName"`
}

// Profile, kaydin istemciye gidebilen kismi.
func (u User) Profile() Profile {
	return Profile{ID: u.ID, Phone: u.Phone, FullName: u.FullName}
}

// Session, bir girisin sunucudaki kaydi (sessions koleksiyonu).
//
// Yenileme jetonunun KENDISI saklanmaz, yalnizca ozeti (SHA-256): veritabani
// sizsa bile kayitlardan kullanilabilir jeton cikmaz. Jeton 32 rastgele bayttir;
// bu entropide yavas bir ozet (bcrypt) gerekmez.
type Session struct {
	ID          string
	UserID      string
	TokenHash   string
	CreatedAt   time.Time
	RefreshedAt time.Time
	ExpiresAt   time.Time
	// IPAddress, girisin yapildigi baglantinin IP'si (B9: istemciden alinmaz).
	// T8.1'in ikinci PR'inda oturum sinyalleri buraya eklenir.
	IPAddress string
}

// refreshTokenBytes, yenileme jetonunun rastgele bayt sayisi (256 bit).
const refreshTokenBytes = 32

// newRefreshToken, opak yenileme jetonu: URL'de guvenli base64 (43 karakter).
func newRefreshToken() string {
	return base64.RawURLEncoding.EncodeToString(ids.RandomBytes(refreshTokenBytes))
}

// HashRefreshToken, jetonun saklanan ozeti. Depolar ve servis ayni ozeti kullanir.
func HashRefreshToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Grant, basarili kayit, giris ya da yenilemenin sonucu
// (@getir/contracts authSessionSchema).
type Grant struct {
	AccessToken      string  `json:"accessToken"`
	TokenType        string  `json:"tokenType"`
	ExpiresIn        int64   `json:"expiresIn"`
	RefreshToken     string  `json:"refreshToken"`
	RefreshExpiresIn int64   `json:"refreshExpiresIn"`
	User             Profile `json:"user"`
}

// tokenTypeBearer, tek desteklenen jeton turu.
const tokenTypeBearer = "Bearer"

// RequestMeta, istegin SUNUCU tarafi bilgisi (B9: risk sinyalleri istemciden
// alinmaz). T8.1'in ikinci PR'inda cihaz ve oturum sinyalleri eklenir.
type RequestMeta struct {
	IPAddress string
}
