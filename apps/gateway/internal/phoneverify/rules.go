// Package phoneverify, telefon numarasini degistirme ve dogrulamadir (T11.14
// PR 3; ADR-12 2. eki): numaraya SMS ile 6 haneli kod gider, kod dogrulaninca
// numara hesaba yazilir ve dogrulanmis sayilir (phoneVerifiedAt).
//
//	rules.go   - girdiler, alan adlari ve cumleler
//	message.go - SMS metni
//	service.go - is kurali: gonder ve dogrula
//
// Kod kurallari ve bekleyen kodun deposu (verify:phone:{usr_...})
// internal/verification'da; e-postayla ayni. Telefon GIRIS KIMLIGIDIR: baska
// bir numaraya gecmek simdiki sifreyi ister ve basarida diger oturumlari
// kapatir. Simdiki numarayi dogrulamak ("Doğrula") sifre istemez.
package phoneverify

import (
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/verification"
)

// Alan adlari: istek govdesindekiyle ayni (kod alani verification.FieldCode).
const (
	FieldPhone    = auth.FieldPhone
	FieldPassword = auth.FieldPassword
)

// Cumleler: yalnizca sunucunun bildigi kurallar (sozlesmede cumlesi yok); web
// formu alanin altinda gosterir. Bicim cumleleri auth'unkilerdir (kayit ve
// girisle ayni).
const (
	passwordRequiredReason = "Numarayı değiştirmek için şifreni gir"
	passwordWrongReason    = "Şifre hatalı"
	phoneTakenReason       = "Bu numara başka bir hesapta kayıtlı"
	phoneCurrentReason     = "Bu numara zaten hesabında doğrulanmış"
)

// SendInput, kod gonderme girdisi (POST /v1/me/phone/code). Password yalnizca
// numara degisirken gerekir; bossa verilmemis sayilir.
type SendInput struct {
	Phone    string
	Password string
}

// Check, bicimi dogrular: numara E.164 (kayittaki kural), sifre verildiyse
// kayittaki uzunluk kurali. Hatalar alan -> sebep haritasidir.
func (in SendInput) Check() map[string]string {
	if in.Password == "" {
		return auth.PhoneCheckInput{Phone: in.Phone}.Check()
	}
	return auth.LoginInput{Phone: in.Phone, Password: in.Password}.Check()
}

// VerifyInput, dogrulama girdisi (POST /v1/me/phone/verify).
type VerifyInput struct {
	Phone string
	Code  string
}

// Check, numaranin ve kodun bicimini dogrular.
func (in VerifyInput) Check() map[string]string {
	problems := auth.PhoneCheckInput{Phone: in.Phone}.Check()
	if !verification.ValidCode(in.Code) {
		problems[verification.FieldCode] = verification.CodeReason
	}
	return problems
}
