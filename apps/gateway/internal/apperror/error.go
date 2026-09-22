package apperror

import "fmt"

// Error, gateway icinde tasinan tek hata tipi. HTTP katmani onu zarfa cevirir.
type Error struct {
	Code Code
	// Details, istemciye gidebilecek ek baglam (alan -> sebep). nil olabilir.
	Details map[string]string
	// Cause, gunluge yazilacak asil hata. Istemciye GITMEZ.
	Cause error
}

// New, sebepsiz bir hata uretir.
func New(code Code, details map[string]string) *Error {
	return &Error{Code: code, Details: details}
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
