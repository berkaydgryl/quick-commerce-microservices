package content

import "github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"

// AddressSetup, adres ekleme penceresi (T11.8): 1. adim harita + arama,
// 2. adim detay formu. Form kurallari ve hata cumleleri burada degil,
// sozlesmede ve auth paketindedir.
type AddressSetup struct {
	Title             string `json:"title"`
	BackLabel         string `json:"backLabel"`
	PinHint           string `json:"pinHint"`
	SearchLabel       string `json:"searchLabel"`
	SearchPlaceholder string `json:"searchPlaceholder"`
	SearchSubmitLabel string `json:"searchSubmitLabel"`
	SearchEmptyNotice string `json:"searchEmptyNotice"`
	UseAddressLabel   string `json:"useAddressLabel"`
	ResolvingLabel    string `json:"resolvingLabel"`
	UnresolvedNotice  string `json:"unresolvedNotice"`
	KindLabel         string `json:"kindLabel"`
	// Kinds, adres turu secicisinin satirlari (Ev, Is, Diger).
	Kinds          []AddressKindOption `json:"kinds"`
	TitleLabel     string              `json:"titleLabel"`
	LineLabel      string              `json:"lineLabel"`
	BuildingLabel  string              `json:"buildingLabel"`
	FloorLabel     string              `json:"floorLabel"`
	ApartmentLabel string              `json:"apartmentLabel"`
	NoteLabel      string              `json:"noteLabel"`
	SaveLabel      string              `json:"saveLabel"`
	SavingLabel    string              `json:"savingLabel"`
	NoMarketNotice string              `json:"noMarketNotice"`
	Map            Map                 `json:"map"`
}

// AddressKindOption, adres turu: sozlesmedeki tur ("HOME"), etiket ve ikon (emoji).
type AddressKindOption struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Icon  string `json:"icon"`
}

// Map, adres haritasi: karo adresi ({z}/{x}/{y}), atif (OSM lisansi geregi
// haritada gorunur), baslangic noktasi ve yakinlastirma. Karo adresi disari
// gider; gateway cozmez, oldugu gibi tasir.
type Map struct {
	TileURL     string        `json:"tileUrl"`
	Attribution string        `json:"attribution"`
	Center      rest.GeoPoint `json:"center"`
	Zoom        int           `json:"zoom"`
}
