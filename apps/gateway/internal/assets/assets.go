// Package assets, verideki GORELI gorsel yolunu istemciye giden MUTLAK URL'ye
// cevirir (BFF sorumlulugu).
//
// NEDEN GATEWAY'DE: veri yolu saklar ("/img/cat/sut.png") cunku mutlak adres
// ortama baglidir (yerel, demo, canli); sozlesme ise mutlak URL ister
// (@getir/contracts: imageUrl z.string().url()). Ceviri tek dis kapida
// yapilir: CDN degisirse yalnizca ASSET_BASE_URL degisir, veri degismez ve
// hicbir istemci kok adres bilmek zorunda kalmaz.
package assets

import (
	"net/url"
	"path"
	"strings"
)

// Resolver, kok adrese gore yol cozer.
type Resolver struct {
	base *url.URL
}

// NewResolver, dogrulanmis bir kok adresle cozumleyici kurar
// (config.Load: mutlak http(s), sorgu ve parca yok, sonda "/" yok).
func NewResolver(base *url.URL) Resolver {
	return Resolver{base: base}
}

// Resolve, gorsel yolunu istemciye gidecek bicime cevirir.
//
//	""                         -> ""        (gorsel yok; alan cevaba hic yazilmaz)
//	"/img/cat/sut.png"         -> kok + yol
//	"img/cat/sut.png"          -> kok + "/" + yol
//	"https://cdn.x/a.png"      -> oldugu gibi (veri zaten mutlak adres tasiyor)
//	"javascript:..." / "data:" -> ""        (http(s) disi sema istemciye GITMEZ)
//
// Son kural bir savunmadir: imageUrl istemcide <img src> olarak kullanilir;
// veriye bir sekilde sizmis baska bir sema tarayicida calisabilecek bir
// adres olurdu. Gorselsiz kategori, zararli adresten iyidir.
func (r Resolver) Resolve(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return ""
	}
	if parsed.IsAbs() {
		if parsed.Scheme == "http" || parsed.Scheme == "https" {
			return trimmed
		}
		return ""
	}
	// Sema yok ama sunucu var ("//baska.site/x.png"): tarayici bunu BASKA bir
	// alan adina gider diye yorumlar. Kokun altina alinir, disari cikamaz.
	if parsed.Host != "" {
		return r.join("/" + parsed.Host + parsed.Path)
	}
	return r.join(parsed.Path)
}

// join, yolu kokun altina ekler ve URL kurallarina gore kacislar
// ("süt" -> "s%C3%BCt").
//
// DIKKAT - SIRA ONEMLI: yol ONCE kendi basina "/" koku altinda temizlenir,
// SONRA kok adrese eklenir. JoinPath birlesik yolun tamamini temizledigi icin
// dogrudan verilseydi "/img/../../x" kok adresin alt yolundan ("/static")
// yukari cikardi. path.Clean("/"+...) koku gecen ".." bolumlerini yutar.
func (r Resolver) join(relative string) string {
	return r.base.JoinPath(path.Clean("/" + relative)).String()
}
