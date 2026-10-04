package auth

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// Girdi kurallari: @getir/contracts ile AYNI (constants.ts: PHONE_PATTERN,
// PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, FULL_NAME_MIN_LENGTH,
// FULL_NAME_MAX_LENGTH). Go bir TypeScript paketini okuyamadigi icin degerler
// burada yazilidir; rules_contract_test.go iki tarafi karsilastirir: biri
// degisip digeri unutulursa test kirilir.
const (
	phonePattern      = `^\+905[0-9]{9}$`
	passwordMinLength = 8
	// passwordMaxBytes, BAYT: bcrypt girdinin ilk 72 baytini kullanir.
	passwordMaxBytes  = 72
	fullNameMinLength = 2
	fullNameMaxLength = 80
)

var phoneRegexp = regexp.MustCompile(phonePattern)

// Sebepler: istemcinin gordugu alan mesajlari. Web formu bunlari alanin altinda
// KULLANICIYA gosterir; bu yuzden Turkce karakterlerle yazilir ve sozlesmedeki
// cumlelerle birebir aynidir (rules_contract_test.go).
const (
	phoneReason       = "Cep telefonu numarası 5 ile başlayan 10 rakam olmalı (örnek 532 123 45 67)"
	passwordMinReason = "en az 8 karakter olmalı"
	passwordMaxReason = "en fazla 72 bayt olmalı (Türkçe harfler iki bayt sayılır)"
	fullNameMinReason = "en az 2 karakter olmalı"
	fullNameMaxReason = "en fazla 80 karakter olmalı"
	// phoneUnknownReason, sifre yenilemede numarayla kayitli hesap yok (T11.9;
	// yalnizca sunucunun bildigi kural, sozlesmede cumlesi yok).
	phoneUnknownReason = "Bu numarayla kayıtlı bir hesap yok"
)

// Alan adlari: istek govdesindekiyle ayni.
const (
	FieldPhone    = "phone"
	FieldPassword = "password"
	FieldFullName = "fullName"
)

// RegisterInput, kayit girdisi.
type RegisterInput struct {
	Phone    string
	Password string
	FullName string
}

// LoginInput, giris girdisi.
type LoginInput struct {
	Phone    string
	Password string
}

// ResetPasswordInput, sifre yenileme girdisi (T11.9: POST /v1/auth/password-reset).
type ResetPasswordInput struct {
	Phone    string
	Password string
}

// PhoneCheckInput, numara kontrolu girdisi (T11.7: POST /v1/auth/phone-check).
type PhoneCheckInput struct {
	Phone string
}

// Check, numaranin bicimini dogrular (sozlesmenin E.164 kurali).
func (in PhoneCheckInput) Check() map[string]string {
	problems := map[string]string{}
	checkPhone(in.Phone, problems)
	return problems
}

// Check, kayit girdisini dogrular ve adi kirpar. Hatalar alan -> sebep
// haritasidir; bossa girdi gecerlidir.
func (in *RegisterInput) Check() map[string]string {
	problems := map[string]string{}
	checkPhone(in.Phone, problems)
	checkPassword(in.Password, problems)
	in.FullName = checkFullName(in.FullName, problems)
	return problems
}

// ProfileUpdateInput, ad degistirme girdisi (T11.14 PR 3, #89: PATCH /v1/me).
type ProfileUpdateInput struct {
	FullName string
}

// Check, adi kirpip kayittaki kuralla dogrular.
func (in *ProfileUpdateInput) Check() map[string]string {
	problems := map[string]string{}
	in.FullName = checkFullName(in.FullName, problems)
	return problems
}

// checkFullName, kirpilmis adi doner; kural ihlalini problems'e yazar.
func checkFullName(raw string, problems map[string]string) string {
	fullName := strings.TrimSpace(raw)
	switch length := utf8.RuneCountInString(fullName); {
	case length < fullNameMinLength:
		problems[FieldFullName] = fullNameMinReason
	case length > fullNameMaxLength:
		problems[FieldFullName] = fullNameMaxReason
	}
	return fullName
}

// Check, sifre yenileme girdisini dogrular: kayittaki telefon ve sifre kurali.
func (in ResetPasswordInput) Check() map[string]string {
	problems := map[string]string{}
	checkPhone(in.Phone, problems)
	checkPassword(in.Password, problems)
	return problems
}

// Check, giris girdisini dogrular. Sifrenin DOGRULUGU degil yalnizca BICIMI:
// bicimsiz bir sifreyle bcrypt calistirmak bosuna maliyet olurdu.
func (in LoginInput) Check() map[string]string {
	problems := map[string]string{}
	checkPhone(in.Phone, problems)
	checkPassword(in.Password, problems)
	return problems
}

func checkPhone(phone string, problems map[string]string) {
	if !phoneRegexp.MatchString(phone) {
		problems[FieldPhone] = phoneReason
	}
}

// checkPassword: alt sinir KARAKTER (sozlesmedeki gibi), ust sinir BAYT.
func checkPassword(password string, problems map[string]string) {
	switch {
	case utf8.RuneCountInString(password) < passwordMinLength:
		problems[FieldPassword] = passwordMinReason
	case len(password) > passwordMaxBytes:
		problems[FieldPassword] = passwordMaxReason
	}
}
