package auth

// Locator, IP adresini oturum konumuna cevirir (GeoIP). Cozemezse false.
//
// Konum IP'den cozulur, istemciden ALINMAZ (B9): tarayicinin bildirdigi konum
// kullanicinin elindedir. Yerelde ve MOCK'ta gercegi yoktur (NoLocator): IP
// geri donus ya da ozel ag adresidir. Production'da bir GeoIP veritabani
// gerekir (bekleyen is); o gelene kadar oturum konumu kullanicinin son bilinen
// konumundan gelir, o da yoksa bilinmez ve geofence kurali tetiklenmez.
type Locator interface {
	Locate(ip string) (Located, bool)
}

// Located, IP'nin cozuldugu konum ve sehir.
type Located struct {
	Location GeoPoint
	City     string
}

// NoLocator, hicbir IP'yi cozmez.
type NoLocator struct{}

// Locate, her zaman "bilinmiyor" der.
func (NoLocator) Locate(string) (Located, bool) {
	return Located{}, false
}
