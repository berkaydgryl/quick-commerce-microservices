// Package emailverify, profilde e-posta dogrulamasidir (T11.14; ADR-12 eki):
// adrese 6 haneli kod gonderilir, kod dogrulaninca adres hesaba yazilir.
//
//	rules.go   - kurallar, alan adlari ve cumleler (sozlesmeyle ayni)
//	code.go    - kod uretimi ve kodun ozeti (HMAC)
//	store.go   - bekleyen dogrulamanin deposu (arayuz ve sonuclar)
//	redis.go   - depo: Redis, tek hash + Lua (anahtar verify:email:{usr_...})
//	memory.go  - depo: bellek (MOCK ve testler)
//	message.go - iletinin icerigi (gomulu sablonlar)
//	service.go - is kurali: gonder ve dogrula
//
// E-posta KIMLIK DEGILDIR: giris telefon + sifredir. Hesaba yalnizca
// dogrulanmis adres yazilir (users.email, kismi benzersiz indeks).
package emailverify

import (
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Kurallar: @getir/contracts ile AYNI (constants.ts: EMAIL_MAX_LENGTH,
// EMAIL_PATTERN, OTP_PATTERN, EMAIL_CODE_TTL_SECONDS, EMAIL_CODE_MAX_ATTEMPTS,
// EMAIL_CODE_RESEND_SECONDS). contract_test.go iki tarafi karsilastirir.
const (
	// CodeTTL, kodun gecerliligi (kullanicinin karari A2: 10 dakika).
	CodeTTL = 600 * time.Second
	// MaxAttempts, kodun iptal edildigi yanlis deneme sayisi (A2: 5).
	MaxAttempts = 5
	// ResendAfter, yeni kod icin en kisa bekleme (A2: 60 saniye).
	ResendAfter = 60 * time.Second

	emailMaxLength = 254
	emailPattern   = `^[^\s@]+@[^\s@]+\.[^\s@]+$`
	codePattern    = `^[0-9]{6}$`
	// codeDigits, kodun rakam sayisi (codePattern ile ayni).
	codeDigits = 6
)

var (
	emailRegexp = regexp.MustCompile(emailPattern)
	codeRegexp  = regexp.MustCompile(codePattern)
)

// Alan adlari: istek govdesindekiyle ayni.
const (
	FieldEmail = "email"
	FieldCode  = "code"
)

// Sebepler: istemcinin gordugu alan mesajlari; web formu alanin altinda
// gosterir. Ilk ucu sozlesmedeki cumlelerle birebir aynidir (contract_test);
// gerisi yalnizca sunucunun bildigi kurallardir (adres baska hesapta, kod
// yanlis, sure doldu), sozlesmede cumlesi yoktur.
const (
	emailReason    = "Geçerli bir e-posta adresi gir (örnek ad@ornek.com)"
	emailMaxReason = "en fazla 254 karakter olmalı"
	codeReason     = "Kod 6 rakam olmalı"

	emailTakenReason   = "Bu e-posta adresi başka bir hesapta kayıtlı"
	emailCurrentReason = "Bu e-posta adresi zaten hesabında doğrulanmış"
	codeExpiredReason  = "Kodun süresi doldu. Yeni kod isteyebilirsin."
	codeLockedReason   = "Kod 5 kez hatalı girildi. Yeni kod isteyebilirsin."
	// codeWrongFormat, kalan hakla: "Kod hatalı. 3 deneme hakkın kaldı."
	codeWrongFormat = "Kod hatalı. %d deneme hakkın kaldı."
)

// SendInput, kod gonderme girdisi (POST /v1/me/email/code).
type SendInput struct {
	Email string
}

// Check, adresi kucuk harfe cevirip dogrular. Hatalar alan -> sebep
// haritasidir; bossa girdi gecerlidir.
func (in *SendInput) Check() map[string]string {
	problems := map[string]string{}
	in.Email = checkEmail(in.Email, problems)
	return problems
}

// VerifyInput, dogrulama girdisi (POST /v1/me/email/verify).
type VerifyInput struct {
	Email string
	Code  string
}

// Check, adresi kucuk harfe cevirip adresi ve kodun bicimini dogrular.
func (in *VerifyInput) Check() map[string]string {
	problems := map[string]string{}
	in.Email = checkEmail(in.Email, problems)
	if !codeRegexp.MatchString(in.Code) {
		problems[FieldCode] = codeReason
	}
	return problems
}

// checkEmail, sozlesmenin emailSchema'si: kirp, kucuk harf, uzunluk, desen.
// Desen RE2'de \s'i yalnizca ASCII bosluk sayar (JavaScript Unicode bosluklari
// da sayar); bu yuzden Unicode bosluk ayrica reddedilir: iki taraf ayni adresi
// kabul etsin.
func checkEmail(raw string, problems map[string]string) string {
	email := strings.ToLower(strings.TrimSpace(raw))
	switch {
	case utf8.RuneCountInString(email) > emailMaxLength:
		problems[FieldEmail] = emailMaxReason
	case !emailRegexp.MatchString(email) || strings.IndexFunc(email, unicode.IsSpace) >= 0:
		problems[FieldEmail] = emailReason
	}
	return email
}
