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
	phonePattern      = `^\+90[0-9]{10}$`
	passwordMinLength = 8
	// passwordMaxBytes, BAYT: bcrypt girdinin ilk 72 baytini kullanir.
	passwordMaxBytes  = 72
	fullNameMinLength = 2
	fullNameMaxLength = 80
)

var phoneRegexp = regexp.MustCompile(phonePattern)

// Sebepler: istemcinin gordugu alan mesajlari (sozlesmedeki Turkce mesajlarla ayni).
const (
	phoneReason       = "+90 ile baslayan 13 karakter olmali (ornek +905321234567)"
	passwordMinReason = "en az 8 karakter olmali"
	passwordMaxReason = "en fazla 72 bayt olmali (Turkce harfler iki bayt sayilir)"
	fullNameMinReason = "en az 2 karakter olmali"
	fullNameMaxReason = "en fazla 80 karakter olmali"
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

// Check, kayit girdisini dogrular ve adi kirpar. Hatalar alan -> sebep
// haritasidir; bossa girdi gecerlidir.
func (in *RegisterInput) Check() map[string]string {
	in.FullName = strings.TrimSpace(in.FullName)
	problems := map[string]string{}
	checkPhone(in.Phone, problems)
	checkPassword(in.Password, problems)
	switch length := utf8.RuneCountInString(in.FullName); {
	case length < fullNameMinLength:
		problems[FieldFullName] = fullNameMinReason
	case length > fullNameMaxLength:
		problems[FieldFullName] = fullNameMaxReason
	}
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
