package content

// Addresses, Adreslerim sekmesinin metinleri (T11.15; /hesabim/adreslerim):
// liste, satir eylemleri, ekleme satirlari, duzenleme penceresi ve silme
// onayi. *Suffix alanlari adin arkasina eklenir ("Ev adresini düzenle").
// Yalnizca metin; kural yok.
type Addresses struct {
	Title                 string             `json:"title"`
	LoadingLabel          string             `json:"loadingLabel"`
	EmptyNotice           string             `json:"emptyNotice"`
	SelectedLabel         string             `json:"selectedLabel"`
	EditSuffix            string             `json:"editSuffix"`
	DeleteSuffix          string             `json:"deleteSuffix"`
	AddOptions            []AddressAddOption `json:"addOptions"`
	EditTitle             string             `json:"editTitle"`
	DeleteLabel           string             `json:"deleteLabel"`
	ConfirmTitle          string             `json:"confirmTitle"`
	ConfirmQuestionSuffix string             `json:"confirmQuestionSuffix"`
	ConfirmHint           string             `json:"confirmHint"`
	ConfirmLabel          string             `json:"confirmLabel"`
	DeletingLabel         string             `json:"deletingLabel"`
	CancelLabel           string             `json:"cancelLabel"`
	DeletedToastSuffix    string             `json:"deletedToastSuffix"`
	UpdatedToast          string             `json:"updatedToast"`
}

// AddressAddOption, Adreslerim'in ekleme satiri: tur ve metni ("Ev adresi ekle").
type AddressAddOption struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
}
