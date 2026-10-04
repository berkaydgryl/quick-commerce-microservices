// Package emailverify, profilde e-posta dogrulamasidir (T11.14; ADR-12 eki):
// adrese 6 haneli kod gonderilir, kod dogrulaninca adres hesaba yazilir.
//
//	rules.go   - e-posta kurallari, alan adi ve cumleler (sozlesmeyle ayni)
//	message.go - iletinin icerigi (gomulu sablonlar)
//	service.go - is kurali: gonder ve dogrula
//
// Kod kurallari, kodun ozeti ve bekleyen kodun deposu (verify:email:{usr_...})
// kanaldan bagimsizdir: internal/verification (T11.14 PR 3'te ayrildi).
//
// E-posta KIMLIK DEGILDIR: giris telefon + sifredir. Hesaba yalnizca
// dogrulanmis adres yazilir (users.email, kismi benzersiz indeks).
package emailverify

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/verification"
)

// Kurallar: @getir/contracts ile AYNI (constants.ts: EMAIL_MAX_LENGTH,
// EMAIL_PATTERN). contract_test.go iki tarafi karsilastirir. Kodun kurallari
// verification'da.
const (
	emailMaxLength = 254
	emailPattern   = `^[^\s@]+@[^\s@]+\.[^\s@]+$`
)

var emailRegexp = regexp.MustCompile(emailPattern)

// FieldEmail, adres alaninin adi: istek govdesindekiyle ayni. Kod alani
// verification.FieldCode.
const FieldEmail = "email"

// Sebepler: istemcinin gordugu alan mesajlari; web formu alanin altinda
// gosterir. Ilk ikisi sozlesmedeki cumlelerle birebir aynidir (contract_test);
// gerisi yalnizca sunucunun bildigi kurallardir (adres baska hesapta, zaten bu
// hesapta), sozlesmede cumlesi yoktur.
const (
	emailReason    = "Geçerli bir e-posta adresi gir (örnek ad@ornek.com)"
	emailMaxReason = "en fazla 254 karakter olmalı"

	emailTakenReason   = "Bu e-posta adresi başka bir hesapta kayıtlı"
	emailCurrentReason = "Bu e-posta adresi zaten hesabında doğrulanmış"
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
	if !verification.ValidCode(in.Code) {
		problems[verification.FieldCode] = verification.CodeReason
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
