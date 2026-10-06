package config

import (
	"log/slog"
)

// Secret, gunluge ya da hata metnine yazilmamasi gereken deger. fmt (%v, %s,
// %x) ve slog onu "[gizli]" olarak basar; bayt icerigine yalnizca Bytes ile ulasilir.
type Secret []byte

// String, degeri gizler.
func (Secret) String() string { return redacted }

// LogValue, slog icin degeri gizler.
func (Secret) LogValue() slog.Value { return slog.StringValue(redacted) }

// Bytes, imza icin ham deger.
func (s Secret) Bytes() []byte { return []byte(s) }

const redacted = "[gizli]"
