package httpapi

import (
	"strings"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// Kimlik uclarinin istek govdeleri (@getir/contracts auth.ts).
//
// Kurallar (telefon bicimi, sifre uzunlugu, ad uzunlugu) auth paketindedir
// (rules.go, sozlesmeyle ayni degerler); burada govde girdiye cevrilir ve
// kuralin buldugu sorunlar ayni details haritasina yazilir. Boylece baslik
// (Idempotency-Key) ve govde hatalari TEK cevapta doner.

const refreshTokenField = "refreshToken"

// registerBody, POST /v1/auth/register (registerRequestSchema).
type registerBody struct {
	Phone    string `json:"phone"`
	Password string `json:"password"`
	FullName string `json:"fullName"`
}

// loginBody, POST /v1/auth/login (loginRequestSchema).
type loginBody struct {
	Phone    string `json:"phone"`
	Password string `json:"password"`
}

// refreshTokenBody, POST /v1/auth/refresh ve /v1/auth/logout
// (refreshRequestSchema, logoutRequestSchema).
type refreshTokenBody struct {
	RefreshToken string `json:"refreshToken"`
}

// logoutResult, cikis cevabi (logoutResultSchema). revoked false hata degildir:
// jeton zaten iptal edilmis ya da suresi dolmus olabilir.
type logoutResult struct {
	Revoked bool `json:"revoked"`
}

// toInput, kayit govdesini girdiye cevirir; kural sorunlarini errs'e yazar.
func (b registerBody) toInput(errs fieldErrors) auth.RegisterInput {
	input := auth.RegisterInput{Phone: b.Phone, Password: b.Password, FullName: b.FullName}
	collect(errs, input.Check())
	return input
}

// toInput, giris govdesini girdiye cevirir; bicim sorunlarini errs'e yazar.
func (b loginBody) toInput(errs fieldErrors) auth.LoginInput {
	input := auth.LoginInput{Phone: b.Phone, Password: b.Password}
	collect(errs, input.Check())
	return input
}

// token, kirpilmis yenileme jetonu; bossa errs'e yazar.
func (b refreshTokenBody) token(errs fieldErrors) string {
	token := strings.TrimSpace(b.RefreshToken)
	if token == "" {
		errs[refreshTokenField] = requiredReason
	}
	return token
}

// collect, kuralin buldugu sorunlari details haritasina ekler.
func collect(errs fieldErrors, problems map[string]string) {
	for field, reason := range problems {
		errs[field] = reason
	}
}
