package httpapi

import (
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

// Kimlik uclarinin istek govdeleri (@getir/contracts auth.ts).
//
// Kurallar (telefon bicimi, sifre uzunlugu, ad uzunlugu) auth paketindedir
// (rules.go, sozlesmeyle ayni degerler); burada govde girdiye cevrilir ve
// kuralin buldugu sorunlar ayni details haritasina yazilir. Boylece baslik
// (Idempotency-Key) ve govde hatalari TEK cevapta doner.

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

// addressCreateBody, POST /v1/me/addresses (createAddressRequestSchema; T11.8).
type addressCreateBody struct {
	Title     string        `json:"title"`
	Kind      string        `json:"kind"`
	Line      string        `json:"line"`
	Location  *geoPointBody `json:"location"`
	Building  string        `json:"building"`
	Floor     string        `json:"floor"`
	Apartment string        `json:"apartment"`
	Note      string        `json:"note"`
}

// toInput, adres govdesini girdiye cevirir; kural sorunlarini errs'e yazar.
// Konum gonderilip bir koordinati eksikse sorun o koordinattadir
// ("location.lat"); ayrica "location zorunlu" yazilmaz.
func (b addressCreateBody) toInput(errs fieldErrors) auth.AddressInput {
	input := auth.AddressInput{
		Title: b.Title, Kind: b.Kind, Line: b.Line,
		Building: b.Building, Floor: b.Floor, Apartment: b.Apartment, Note: b.Note,
	}
	if point := b.Location.toPoint(auth.FieldLocation, errs); point != nil {
		input.Location = &auth.GeoPoint{Lat: point.Lat, Lng: point.Lng}
	}
	problems := input.Check()
	if b.Location != nil {
		delete(problems, auth.FieldLocation)
	}
	collect(errs, problems)
	return input
}

// phoneCheckBody, POST /v1/auth/phone-check (phoneCheckRequestSchema).
type phoneCheckBody struct {
	Phone string `json:"phone"`
}

// phoneCheckResult, numara kontrolunun cevabi (phoneCheckResultSchema).
type phoneCheckResult struct {
	Registered bool `json:"registered"`
}

// toInput, numara kontrolu govdesini girdiye cevirir; bicim sorununu errs'e yazar.
func (b phoneCheckBody) toInput(errs fieldErrors) auth.PhoneCheckInput {
	input := auth.PhoneCheckInput{Phone: b.Phone}
	collect(errs, input.Check())
	return input
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

// collect, kuralin buldugu sorunlari details haritasina ekler.
func collect(errs fieldErrors, problems map[string]string) {
	for field, reason := range problems {
		errs[field] = reason
	}
}
