package content

// Banner, ayni gorselin boylari ve dogal boyutu (oran icin).
type Banner struct {
	Sources []BannerSource `json:"sources"`
	Width   int            `json:"width"`
	Height  int            `json:"height"`
}

// BannerSource, banner'in bir boyu. URL dosyada GORELI yoldur, cevapta
// mutlak adres (assets.Resolver).
type BannerSource struct {
	URL   string `json:"url"`
	Width int    `json:"width"`
}
