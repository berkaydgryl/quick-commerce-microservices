package httpapi

import (
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/phoneverify"
)

// Profil duzenleme uclarinin istek govdeleri (@getir/contracts auth.ts
// updateProfileRequestSchema, phone.ts; T11.14 PR 3).

// profileUpdateBody, PATCH /v1/me.
type profileUpdateBody struct {
	FullName string `json:"fullName"`
}

// toInput, govdeyi girdiye cevirir; kural sorununu errs'e yazar.
func (b profileUpdateBody) toInput(errs fieldErrors) auth.ProfileUpdateInput {
	input := auth.ProfileUpdateInput{FullName: b.FullName}
	collect(errs, input.Check())
	return input
}

// phoneCodeBody, POST /v1/me/phone/code. Password yalnizca numara degisirken.
type phoneCodeBody struct {
	Phone    string `json:"phone"`
	Password string `json:"password"`
}

// toInput, govdeyi girdiye cevirir; bicim sorunlarini errs'e yazar.
func (b phoneCodeBody) toInput(errs fieldErrors) phoneverify.SendInput {
	input := phoneverify.SendInput{Phone: b.Phone, Password: b.Password}
	collect(errs, input.Check())
	return input
}

// phoneVerifyBody, POST /v1/me/phone/verify.
type phoneVerifyBody struct {
	Phone string `json:"phone"`
	Code  string `json:"code"`
}

// toInput, govdeyi girdiye cevirir; bicim sorunlarini errs'e yazar.
func (b phoneVerifyBody) toInput(errs fieldErrors) phoneverify.VerifyInput {
	input := phoneverify.VerifyInput{Phone: b.Phone, Code: b.Code}
	collect(errs, input.Check())
	return input
}
