package testkit

import "regexp"

// Rastgele gurultu (T11.17; @getir/core/testing withoutRandomNoise'in Go esi):
// kisa bir sirri (CVV "9183") gunluk ya da cevap metninde ararken rastgele bir
// kimligin icinde tesadufi eslesme ("req_8b21ab37ec584a9183af1f3aa53152d7")
// testi yanlis alarmla dusurur. Kural: 6 hane ve alti sir ham metinde aranmaz,
// once bu fonksiyondan gecer.
//
// YALNIZCA bilinen rastgele bicimler maskelenir: onekli kimlik (<onek>_<32
// onaltilik>) ve bilinen rastgele alanlarin degeri (sure, zaman, iz). GENEL
// rakam dizisi MASKELENMEZ: sizan kart numarasi gorunur kalmalidir.
var (
	prefixedID       = regexp.MustCompile(`\b[a-z]{2,8}_[0-9a-f]{32}\b`)
	randomFieldValue = regexp.MustCompile(`"(durationMs|time|traceId|spanId)":("[^"]*"|-?[0-9][0-9.eE+-]*)`)
)

// WithoutRandomNoise, metindeki onekli kimlikleri ve rastgele alan degerlerini maskeler.
func WithoutRandomNoise(text string) string {
	masked := prefixedID.ReplaceAllString(text, "<kimlik>")
	return randomFieldValue.ReplaceAllString(masked, `"$1":"<rastgele>"`)
}
