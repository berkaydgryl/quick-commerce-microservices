package content

// Image, tek boy bir gorsel: adres ve dogal boyut. URL dosyada goreli yol,
// cevapta mutlak adres (assets.Resolver).
type Image struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// StoreLink, magaza rozeti. URL disari giden https baglantisidir; gateway
// cozmez, oldugu gibi tasir. Rozet gorseli goreli yoldur.
type StoreLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
	Badge Image  `json:"badge"`
}

// AppDownload, uygulama indirme bandi (T11.7).
type AppDownload struct {
	Title    string      `json:"title"`
	Subtitle string      `json:"subtitle"`
	Image    Image       `json:"image"`
	Stores   []StoreLink `json:"stores"`
}

// Feature, tanitim kutusu (T11.7): gorsel + metin.
type Feature struct {
	Image Image  `json:"image"`
	Text  string `json:"text"`
}
