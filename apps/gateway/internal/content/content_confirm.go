package content

// Confirm, ortak onay penceresinin dugmeleri (F13; 07.10 kullanici istegi):
// butun silme onaylari ayni pencere, solda "Hayır", sagda "Evet". Soru silinen
// seye gore ekranin kendi blogunda. Yalnizca metin; kural yok.
type Confirm struct {
	YesLabel string `json:"yesLabel"`
	NoLabel  string `json:"noLabel"`
}
