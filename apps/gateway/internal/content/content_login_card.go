package content

// LoginCard, karsilama karti ile giris ve kayit penceresinin metinleri.
type LoginCard struct {
	Title        string `json:"title"`
	CountryLabel string `json:"countryLabel"`
	// PhoneLabel, telefon alaninin etiketi ("Telefon Numarası"): bos alanda
	// kutunun icinde, deger girilince uste kayar (T11.16; ipucu yok).
	PhoneLabel    string `json:"phoneLabel"`
	ContinueLabel string `json:"continueLabel"`
	CloseLabel    string `json:"closeLabel"`
	// ShowPasswordLabel ve HidePasswordLabel, sifre alanindaki goz dugmesinin
	// duruma gore adi: gizliyken "Şifreyi göster", gorunurken "Şifreyi gizle".
	ShowPasswordLabel string         `json:"showPasswordLabel"`
	HidePasswordLabel string         `json:"hidePasswordLabel"`
	Countries         []PhoneCountry `json:"countries"`
	// ForgotPasswordLabel, karttaki ve giris penceresindeki "Sifremi unuttum" (T11.9).
	ForgotPasswordLabel string            `json:"forgotPasswordLabel"`
	Login               LoginStep         `json:"login"`
	Register            RegisterStep      `json:"register"`
	ResetPassword       ResetPasswordStep `json:"resetPassword"`
}

// PhoneCountry, ulke kodu secicisinin bir satiri. FlagURL dosyada goreli yol.
type PhoneCountry struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	DialCode string `json:"dialCode"`
	FlagURL  string `json:"flagUrl"`
}

// LoginStep, giris penceresi (kayitli kullanici).
type LoginStep struct {
	PasswordLabel     string `json:"passwordLabel"`
	SubmitLabel       string `json:"submitLabel"`
	PendingLabel      string `json:"pendingLabel"`
	RegisterPrompt    string `json:"registerPrompt"`
	RegisterLinkLabel string `json:"registerLinkLabel"`
	// UnknownPhoneNotice, kayitsiz numara yazilinca telefonun altindaki uyari (T11.7).
	UnknownPhoneNotice string `json:"unknownPhoneNotice"`
}

// RegisterStep, kayit penceresi (ad soyad, telefon, sifre).
type RegisterStep struct {
	FullNameLabel  string `json:"fullNameLabel"`
	PasswordLabel  string `json:"passwordLabel"`
	SubmitLabel    string `json:"submitLabel"`
	PendingLabel   string `json:"pendingLabel"`
	LoginPrompt    string `json:"loginPrompt"`
	LoginLinkLabel string `json:"loginLinkLabel"`
	// KnownPhoneNotice, kayitli numara yazilinca telefonun altindaki uyari (T11.7).
	KnownPhoneNotice string `json:"knownPhoneNotice"`
}

// ResetPasswordStep, sifre yenileme penceresi (T11.9): telefon ve yeni sifre.
type ResetPasswordStep struct {
	Title          string `json:"title"`
	Description    string `json:"description"`
	PasswordLabel  string `json:"passwordLabel"`
	SubmitLabel    string `json:"submitLabel"`
	PendingLabel   string `json:"pendingLabel"`
	LoginPrompt    string `json:"loginPrompt"`
	LoginLinkLabel string `json:"loginLinkLabel"`
}
