package apperror

import "fmt"

// RetryAfterDetail, RATE_LIMITED hatasinin bekleme ayrintisi (tam saniye):
// hiz siniri (T8.2) ve yeni dogrulama kodu beklemesi (T11.14) ayni adla doner;
// web formu ayni alani okur. HTTP cevabinda Retry-After basligi da yazilir.
const RetryAfterDetail = "retryAfterSeconds"

// Error, gateway icinde tasinan tek hata tipi. HTTP katmani onu zarfa cevirir.
type Error struct {
	Code Code
	// Details, istemciye gidebilecek ek baglam: JSON nesnesinin alanlari. nil
	// olabilir. Gateway'in kendi dogrulama hatalari alan -> sebep METNI tasir;
	// servisten gelen ayrinti oldugu gibi gecer (sayi, dizi, nesne dahil; T7.5).
	Details map[string]any
	// Cause, gunluge yazilacak asil hata. Istemciye GITMEZ.
	Cause error
}

// New, sebepsiz bir hata uretir. details alan -> sebep metnidir (gateway'in
// kendi dogrulamasi); bos harita "ayrinti yok" demektir.
func New(code Code, details map[string]string) *Error {
	return &Error{Code: code, Details: textDetails(details)}
}

func (e *Error) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Code, e.Cause)
	}
	return string(e.Code)
}

func (e *Error) Unwrap() error {
	return e.Cause
}

func textDetails(details map[string]string) map[string]any {
	if len(details) == 0 {
		return nil
	}
	converted := make(map[string]any, len(details))
	for field, reason := range details {
		converted[field] = reason
	}
	return converted
}
