package config

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// readString, bos metni "verilmedi" sayar (docker-compose "VAR=" boyle gecirir).
func readString(getenv Getenv, name, fallback string) string {
	if value := strings.TrimSpace(getenv(name)); value != "" {
		return value
	}
	return fallback
}

func readInt(getenv Getenv, name string, fallback, min, max int) (int, error) {
	raw := strings.TrimSpace(getenv(name))
	if raw == "" {
		return fallback, nil
	}

	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s: tam sayi bekleniyor, alinan %q: %w", name, raw, err)
	}
	if value < min || value > max {
		return 0, fmt.Errorf("%s: %d-%d araliginda olmali, alinan %d", name, min, max, value)
	}
	return value, nil
}

func readBool(getenv Getenv, name string, fallback bool) (bool, error) {
	raw := strings.ToLower(strings.TrimSpace(getenv(name)))
	switch raw {
	case "":
		return fallback, nil
	case "1", "true", "yes", "on":
		return true, nil
	case "0", "false", "no", "off":
		return false, nil
	default:
		return false, fmt.Errorf("%s: boolean bekleniyor (1/0, true/false), alinan %q", name, raw)
	}
}

// readDuration, milisaniye tasiyan degiskeni okur (*_MS sonekli degiskenler).
func readDuration(getenv Getenv, name string, fallback time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(getenv(name))
	if raw == "" {
		return fallback, nil
	}

	milliseconds, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s: milisaniye cinsinden tam sayi bekleniyor, alinan %q: %w", name, raw, err)
	}
	if milliseconds <= 0 {
		return 0, fmt.Errorf("%s: pozitif olmali, alinan %d", name, milliseconds)
	}
	return time.Duration(milliseconds) * time.Millisecond, nil
}

// readSeconds, saniye tasiyan degiskeni okur (JWT_TTL, REFRESH_TTL: adlari
// .env.example ve ADR-12 boyle tanimlar).
func readSeconds(getenv Getenv, name string, fallback time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(getenv(name))
	if raw == "" {
		return fallback, nil
	}

	seconds, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s: saniye cinsinden tam sayi bekleniyor, alinan %q: %w", name, raw, err)
	}
	if seconds <= 0 {
		return 0, fmt.Errorf("%s: pozitif olmali, alinan %d", name, seconds)
	}
	return time.Duration(seconds) * time.Second, nil
}

func readEnum(getenv Getenv, name, fallback string, allowed []string) (string, error) {
	value := readString(getenv, name, fallback)
	for _, candidate := range allowed {
		if value == candidate {
			return value, nil
		}
	}
	return "", fmt.Errorf("%s: %s degerlerinden biri olmali, alinan %q", name, strings.Join(allowed, "|"), value)
}
