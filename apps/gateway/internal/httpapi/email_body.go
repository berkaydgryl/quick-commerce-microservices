package httpapi

import (
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/emailverify"
)

// E-posta dogrulama uclarinin istek govdeleri (@getir/contracts email.ts;
// T11.14). Kurallar emailverify paketindedir (sozlesmeyle ayni); burada govde
// girdiye cevrilir ve sorunlar baslik hatalariyla ayni haritaya yazilir.

// emailCodeBody, POST /v1/me/email/code (sendEmailCodeRequestSchema).
type emailCodeBody struct {
	Email string `json:"email"`
}

// toInput, govdeyi girdiye cevirir; bicim sorununu errs'e yazar.
func (b emailCodeBody) toInput(errs fieldErrors) emailverify.SendInput {
	input := emailverify.SendInput{Email: b.Email}
	collect(errs, input.Check())
	return input
}

// emailVerifyBody, POST /v1/me/email/verify (verifyEmailRequestSchema).
type emailVerifyBody struct {
	Email string `json:"email"`
	Code  string `json:"code"`
}

// toInput, govdeyi girdiye cevirir; bicim sorunlarini errs'e yazar.
func (b emailVerifyBody) toInput(errs fieldErrors) emailverify.VerifyInput {
	input := emailverify.VerifyInput{Email: b.Email, Code: b.Code}
	collect(errs, input.Check())
	return input
}
