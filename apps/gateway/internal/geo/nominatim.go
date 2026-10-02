package geo

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

// maxResponseBytes, Nominatim cevabinin okunacak en buyuk boyu: bes sonuclu
// arama birkac KB'dir; sinir bozuk ya da kotu niyetli bir kaynaga karsidir.
const maxResponseBytes = 1 << 20

// nominatim, Nominatim'in /reverse ve /search uclarinin istemcisi. Sira ve
// onbellek Service'tedir; bu tip yalnizca istegi kurar ve cevabi cozer.
type nominatim struct {
	base      *url.URL
	userAgent string
	http      *http.Client
}

func newNominatim(base *url.URL, userAgent string) *nominatim {
	// Ust sinir istegin baglamindadir (Service.timeout); istemcinin kendi
	// siniri yok ki ikisi birbirini golgelemesin.
	return &nominatim{base: base, userAgent: userAgent, http: &http.Client{}}
}

// place, Nominatim'in jsonv2 cevabindaki bir yer.
type place struct {
	Lat         string  `json:"lat"`
	Lon         string  `json:"lon"`
	DisplayName string  `json:"display_name"`
	Address     address `json:"address"`
	// Error, ters cozumde adres yoksa dolu gelir ("Unable to geocode"; 200 ile).
	Error string `json:"error"`
}

// reverse, noktanin adres satiri; adres yoksa errNoAddress.
func (n *nominatim) reverse(ctx context.Context, lat, lng float64) (string, error) {
	query := n.query()
	query.Set("lat", strconv.FormatFloat(lat, 'f', -1, 64))
	query.Set("lon", strconv.FormatFloat(lng, 'f', -1, 64))
	// 18: bina duzeyi (sokak ve kapi numarasi).
	query.Set("zoom", "18")
	var found place
	if err := n.get(ctx, "reverse", query, &found); err != nil {
		return "", err
	}
	line := found.line()
	if found.Error != "" || line == "" {
		return "", errNoAddress
	}
	return line, nil
}

// search, Turkiye icinde arama; en fazla limit sonuc, ayni satir bir kez.
func (n *nominatim) search(ctx context.Context, text string, limit int) ([]Place, error) {
	query := n.query()
	query.Set("q", text)
	query.Set("countrycodes", "tr")
	query.Set("limit", strconv.Itoa(limit))
	var found []place
	if err := n.get(ctx, "search", query, &found); err != nil {
		return nil, err
	}
	places := make([]Place, 0, min(len(found), limit))
	seen := make(map[string]struct{}, len(found))
	for _, candidate := range found {
		resolved, usable := candidate.place()
		if _, duplicate := seen[resolved.Line]; !usable || duplicate || len(places) == limit {
			continue
		}
		seen[resolved.Line] = struct{}{}
		places = append(places, resolved)
	}
	return places, nil
}

// query, iki ucun ortak parametreleri: JSON, adres alanlari, Turkce adlar.
func (n *nominatim) query() url.Values {
	return url.Values{
		"format":          {"jsonv2"},
		"addressdetails":  {"1"},
		"accept-language": {"tr"},
	}
}

func (n *nominatim) get(ctx context.Context, path string, query url.Values, out any) (err error) {
	target := n.base.JoinPath(path)
	target.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return fmt.Errorf("istek kurulamadi: %w", err)
	}
	request.Header.Set("User-Agent", n.userAgent)
	request.Header.Set("Accept", "application/json")
	response, err := n.http.Do(request)
	if err != nil {
		return fmt.Errorf("%s istegi basarisiz: %w", path, err)
	}
	defer func() {
		if closeErr := response.Body.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("%s cevabi kapatilamadi: %w", path, closeErr)
		}
	}()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("%s cevabi %d", path, response.StatusCode)
	}
	if decodeErr := json.NewDecoder(io.LimitReader(response.Body, maxResponseBytes)).Decode(out); decodeErr != nil {
		return fmt.Errorf("%s cevabi cozulemedi: %w", path, decodeErr)
	}
	return nil
}

// place, arama sonucunu cevirir; konumu ya da satiri olmayan sonuc kullanilmaz.
func (p place) place() (Place, bool) {
	lat, latErr := strconv.ParseFloat(p.Lat, 64)
	lng, lngErr := strconv.ParseFloat(p.Lon, 64)
	line := p.line()
	if latErr != nil || lngErr != nil || len(checkPoint(lat, lng)) > 0 || line == "" {
		return Place{}, false
	}
	return Place{Line: line, Location: rest.GeoPoint{Lat: lat, Lng: lng}}, true
}
