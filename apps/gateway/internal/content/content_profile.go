package content

// Profile, profil kartinin metinleri (T11.14; PR 2'de Hesabim paneli kalkti,
// PR 3'te "Profili düzenle" ve telefon adimi geldi): e-posta ve telefon
// satirlari, kalem ve pencereler. Yalnizca metin; kod kurallari (sure, deneme)
// verification'da.
type Profile struct {
	PhoneLabel       string            `json:"phoneLabel"`
	EmailLabel       string            `json:"emailLabel"`
	AddEmailLabel    string            `json:"addEmailLabel"`
	EditProfileLabel string            `json:"editProfileLabel"`
	VerifiedLabel    string            `json:"verifiedLabel"`
	VerifyPhoneLabel string            `json:"verifyPhoneLabel"`
	LoadingLabel     string            `json:"loadingLabel"`
	EditDialog       EditProfileDialog `json:"editDialog"`
	EmailDialog      EmailDialog       `json:"emailDialog"`
	PhoneDialog      PhoneDialog       `json:"phoneDialog"`
}

// EditProfileDialog, "Profili düzenle" penceresinin genel gorunumu: ad, e-posta
// ve telefon satirlari.
type EditProfileDialog struct {
	Title           string `json:"title"`
	CloseLabel      string `json:"closeLabel"`
	BackLabel       string `json:"backLabel"`
	NameLabel       string `json:"nameLabel"`
	SaveNameLabel   string `json:"saveNameLabel"`
	SavingNameLabel string `json:"savingNameLabel"`
	NameSavedToast  string `json:"nameSavedToast"`
	EmailLabel      string `json:"emailLabel"`
	PhoneLabel      string `json:"phoneLabel"`
	EmptyEmailLabel string `json:"emptyEmailLabel"`
	ChangeLabel     string `json:"changeLabel"`
	AddLabel        string `json:"addLabel"`
	VerifyLabel     string `json:"verifyLabel"`
}

// PhoneDialog, telefon adimi: numara degistirme ya da dogrulama ve kod adimi.
type PhoneDialog struct {
	Title             string `json:"title"`
	ChangeDescription string `json:"changeDescription"`
	VerifyDescription string `json:"verifyDescription"`
	PhoneFieldLabel   string `json:"phoneFieldLabel"`
	PasswordLabel     string `json:"passwordLabel"`
	ShowPasswordLabel string `json:"showPasswordLabel"`
	HidePasswordLabel string `json:"hidePasswordLabel"`
	SendLabel         string `json:"sendLabel"`
	SendingLabel      string `json:"sendingLabel"`
	CodeSentToLabel   string `json:"codeSentToLabel"`
	CodeFieldLabel    string `json:"codeFieldLabel"`
	VerifyLabel       string `json:"verifyLabel"`
	VerifyingLabel    string `json:"verifyingLabel"`
	ExpiresInLabel    string `json:"expiresInLabel"`
	ExpiredNotice     string `json:"expiredNotice"`
	ResendLabel       string `json:"resendLabel"`
	ResendWaitLabel   string `json:"resendWaitLabel"`
	ChangePhoneLabel  string `json:"changePhoneLabel"`
	VerifiedToast     string `json:"verifiedToast"`
	ChangedToast      string `json:"changedToast"`
}

// EmailDialog, e-posta penceresi: adres adimi ve kod adimi.
type EmailDialog struct {
	Title            string `json:"title"`
	CloseLabel       string `json:"closeLabel"`
	EmailDescription string `json:"emailDescription"`
	EmailFieldLabel  string `json:"emailFieldLabel"`
	SendLabel        string `json:"sendLabel"`
	SendingLabel     string `json:"sendingLabel"`
	CodeSentToLabel  string `json:"codeSentToLabel"`
	CodeFieldLabel   string `json:"codeFieldLabel"`
	VerifyLabel      string `json:"verifyLabel"`
	VerifyingLabel   string `json:"verifyingLabel"`
	ExpiresInLabel   string `json:"expiresInLabel"`
	ExpiredNotice    string `json:"expiredNotice"`
	ResendLabel      string `json:"resendLabel"`
	ResendWaitLabel  string `json:"resendWaitLabel"`
	ChangeEmailLabel string `json:"changeEmailLabel"`
	VerifiedToast    string `json:"verifiedToast"`
}
