package assets

import (
	"net/url"
	"testing"
)

func resolver(t *testing.T, base string) Resolver {
	t.Helper()
	parsed, err := url.Parse(base)
	if err != nil {
		t.Fatalf("kok adres: %v", err)
	}
	return NewResolver(parsed)
}

func TestResolve(t *testing.T) {
	r := resolver(t, "https://cdn.example.com/static")

	cases := map[string]struct {
		in   string
		want string
	}{
		"bas slash ile goreli yol":   {"/img/cat/sut.png", "https://cdn.example.com/static/img/cat/sut.png"},
		"slash olmadan goreli yol":   {"img/cat/sut.png", "https://cdn.example.com/static/img/cat/sut.png"},
		"bos yol gorsel yok":         {"", ""},
		"yalnizca bosluk":            {"   ", ""},
		"zaten mutlak https":         {"https://baska.cdn/a.png", "https://baska.cdn/a.png"},
		"zaten mutlak http":          {"http://baska.cdn/a.png", "http://baska.cdn/a.png"},
		"javascript semasi":          {"javascript:alert(1)", ""},
		"data semasi":                {"data:image/png;base64,AAAA", ""},
		"kokun ustune cikamaz":       {"/img/../../gizli.png", "https://cdn.example.com/static/gizli.png"},
		"semasiz baska alan adi":     {"//kotu.site/x.png", "https://cdn.example.com/static/kotu.site/x.png"},
		"turkce karakter kacislanir": {"/img/süt.png", "https://cdn.example.com/static/img/s%C3%BCt.png"},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if got := r.Resolve(tc.in); got != tc.want {
				t.Errorf("Resolve(%q):\n got %q\nwant %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestResolveWithRootBase(t *testing.T) {
	// Kok yolu olmayan adres (en yaygin durum: http://localhost:5173).
	r := resolver(t, "http://localhost:5173")

	if got := r.Resolve("/img/cat/sut.png"); got != "http://localhost:5173/img/cat/sut.png" {
		t.Errorf("got %q", got)
	}
}
