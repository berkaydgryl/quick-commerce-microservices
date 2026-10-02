// Package geo, adres ekleme penceresinin harita adres servisidir (T11.8):
// pinin oldugu noktanin adres satiri (Reverse) ve sokak / posta kodu aramasi
// (Search).
//
// NEDEN GATEWAY'DE: kaynak OpenStreetMap'in ucretsiz Nominatim servisidir ve
// kullanim kosulu saniyede en fazla BIR istek, kendini tanitan User-Agent ve
// sonuclari onbelleklemektir. Istemciler dogrudan cagirsaydi sinir her
// tarayicida ayri sayilir, kosul ihlal edilirdi; gateway butun istekleri tek
// siradan gecirir (throttle.go) ve ayni soruyu tekrar sormaz (cache.go).
// Demo icindir: yuk altinda sira bekleyen istek SERVICE_UNAVAILABLE alir ve
// kullanici adresini elle yazabilir.
//
// Dosyalar:
//
//	geo.go       - Service, kurallar (sozlesmeyle ayni) ve hatalar
//	nominatim.go - Nominatim'e HTTP istegi ve cevabin cozulmesi
//	line.go      - Nominatim adres alanlarindan Turkce adres satiri
//	throttle.go  - istekler arasi en kisa sure (tek sira)
//	cache.go     - sureli, boyutu sinirli onbellek (LRU)
package geo

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/rest"
)

// Kurallar (@getir/contracts geo.ts ve constants.ts; esitligi
// contract_test.go denetler).
const (
	// SearchQueryMinLength ve SearchQueryMaxLength, arama metninin siniri.
	SearchQueryMinLength = 3
	SearchQueryMaxLength = 100
	// SearchResultsMax, aramanin en fazla sonucu.
	SearchResultsMax = 5
	// lineMaxLength, adres satirinin siniri (ADDRESS_LINE_MAX_LENGTH): sonuc
	// dogrudan adres formuna yazilir.
	lineMaxLength = 240
)

// Alan adlari ve sebepler: istekteki sorgu parametresiyle ayni.
const (
	FieldLat   = "lat"
	FieldLng   = "lng"
	FieldQuery = "q"

	latitudeReason  = "enlem -90 ile 90 arasinda olmali"
	longitudeReason = "boylam -180 ile 180 arasinda olmali"
	queryMinReason  = "Arama en az 3 karakter olmalı"
	queryMaxReason  = "Arama en fazla 100 karakter olabilir"
)

// ReverseResult, GET /v1/geo/reverse cevabi (reverseGeocodeResultSchema).
type ReverseResult struct {
	Line string `json:"line"`
}

// Place, arama sonucu: adres satiri ve konum (geoPlaceSchema).
type Place struct {
	Line     string        `json:"line"`
	Location rest.GeoPoint `json:"location"`
}

// SearchResult, GET /v1/geo/search cevabi (geoSearchResultSchema). Sonuc
// yoksa Items bos dizidir (null degil).
type SearchResult struct {
	Items []Place `json:"items"`
}

// Options, servisin ayarlari. Sifir deger yerine varsayilan kullanilir
// (Interval, CacheTTL, CacheSize, Now).
type Options struct {
	// BaseURL, Nominatim kok adresi (GEO_BASE_URL).
	BaseURL *url.URL
	// UserAgent, Nominatim'e kendini tanitan ad (GEO_USER_AGENT; kosul).
	UserAgent string
	// Timeout, tek sorunun ust siniri: sirada bekleme + Nominatim cevabi.
	Timeout time.Duration
	// Interval, Nominatim'e giden iki istek arasindaki en kisa sure.
	Interval time.Duration
	// CacheTTL ve CacheSize, onbellegin omru ve en fazla kaydi.
	CacheTTL  time.Duration
	CacheSize int
	Now       func() time.Time
}

const (
	defaultInterval  = time.Second
	defaultCacheTTL  = 24 * time.Hour
	defaultCacheSize = 1000
)

// Service, Nominatim'e sinirli ve onbellekli giden adres servisi.
type Service struct {
	client   *nominatim
	timeout  time.Duration
	throttle *throttle
	reverse  *cache[reverseEntry]
	search   *cache[[]Place]
}

// reverseEntry, onbellekteki ters cozum: adres bulunamadi da bir cevaptir
// (ayni nokta tekrar sorulmaz).
type reverseEntry struct {
	line  string
	found bool
}

// New, servisi kurar.
func New(opts Options) *Service {
	if opts.Interval <= 0 {
		opts.Interval = defaultInterval
	}
	if opts.CacheTTL <= 0 {
		opts.CacheTTL = defaultCacheTTL
	}
	if opts.CacheSize <= 0 {
		opts.CacheSize = defaultCacheSize
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	return &Service{
		client:   newNominatim(opts.BaseURL, opts.UserAgent),
		timeout:  opts.Timeout,
		throttle: newThrottle(opts.Interval),
		reverse:  newCache[reverseEntry](opts.CacheTTL, opts.CacheSize, opts.Now),
		search:   newCache[[]Place](opts.CacheTTL, opts.CacheSize, opts.Now),
	}
}

// errNoAddress, noktada adres yok (Nominatim "Unable to geocode").
var errNoAddress = errors.New("noktada adres yok")

// Reverse, noktanin adres satiri. Adres yoksa NOT_FOUND: web kullaniciya
// satiri kendisi yazdirir.
func (s *Service) Reverse(ctx context.Context, lat, lng float64) (ReverseResult, error) {
	if problems := checkPoint(lat, lng); len(problems) > 0 {
		return ReverseResult{}, apperror.New(apperror.CodeValidationFailed, problems)
	}
	// ~1 m: ayni evin cevresinde suruklenen pin ayni soruyu sorar.
	key := fmt.Sprintf("%.5f,%.5f", lat, lng)
	entry, cached := s.reverse.get(key)
	if !cached {
		line, err := ask(ctx, s, func(ctx context.Context) (string, error) { return s.client.reverse(ctx, lat, lng) })
		switch {
		case errors.Is(err, errNoAddress):
		case err != nil:
			return ReverseResult{}, unavailable(err)
		}
		entry = reverseEntry{line: line, found: err == nil}
		s.reverse.put(key, entry)
	}
	if !entry.found {
		return ReverseResult{}, apperror.New(apperror.CodeNotFound, nil)
	}
	return ReverseResult{Line: entry.line}, nil
}

// Search, sokak, mahalle ya da posta kodu aramasi (Turkiye). Sonuc yoksa bos liste.
func (s *Service) Search(ctx context.Context, query string) (SearchResult, error) {
	query = strings.Join(strings.Fields(query), " ")
	if problem := checkQuery(query); problem != "" {
		return SearchResult{}, apperror.New(apperror.CodeValidationFailed, map[string]string{FieldQuery: problem})
	}
	key := strings.ToLowerSpecial(unicode.TurkishCase, query)
	places, cached := s.search.get(key)
	if !cached {
		found, err := ask(ctx, s, func(ctx context.Context) ([]Place, error) { return s.client.search(ctx, query, SearchResultsMax) })
		if err != nil {
			return SearchResult{}, unavailable(err)
		}
		places = found
		s.search.put(key, places)
	}
	return SearchResult{Items: append(make([]Place, 0, len(places)), places...)}, nil
}

// ask, tek Nominatim sorusunu ust sinir icinde, siraya girerek sorar.
func ask[T any](ctx context.Context, s *Service, call func(context.Context) (T, error)) (T, error) {
	var zero T
	if s.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.timeout)
		defer cancel()
	}
	if err := s.throttle.wait(ctx); err != nil {
		return zero, err
	}
	return call(ctx)
}

// unavailable, Nominatim'e ulasilamadi (zaman asimi, sira dolu, 5xx, bozuk
// cevap): istemciye SERVICE_UNAVAILABLE, sebep gunluge.
func unavailable(err error) error {
	return &apperror.Error{Code: apperror.CodeServiceUnavailable, Cause: fmt.Errorf("adres servisi: %w", err)}
}

func checkPoint(lat, lng float64) map[string]string {
	problems := map[string]string{}
	if math.IsNaN(lat) || lat < -90 || lat > 90 {
		problems[FieldLat] = latitudeReason
	}
	if math.IsNaN(lng) || lng < -180 || lng > 180 {
		problems[FieldLng] = longitudeReason
	}
	return problems
}

func checkQuery(query string) string {
	switch length := utf8.RuneCountInString(query); {
	case length < SearchQueryMinLength:
		return queryMinReason
	case length > SearchQueryMaxLength:
		return queryMaxReason
	}
	return ""
}
