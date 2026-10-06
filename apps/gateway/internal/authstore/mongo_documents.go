package authstore

import (
	"time"
)

// Koleksiyon adlari (roadmap koleksiyon tablosu).
const (
	UsersCollection    = "users"
	SessionsCollection = "sessions"
)

type userDocument struct {
	ID                   string            `bson:"_id"`
	Phone                string            `bson:"phone"`
	PasswordHash         string            `bson:"passwordHash"`
	FullName             string            `bson:"fullName"`
	CreatedAt            time.Time         `bson:"createdAt"`
	RegistrationDeviceID string            `bson:"registrationDeviceId,omitempty"`
	LastLoginIP          string            `bson:"lastLoginIp,omitempty"`
	LastLocation         *geoPointDocument `bson:"lastLocation,omitempty"`
	Addresses            []addressDocument `bson:"addresses,omitempty"`
	// FavoriteMarkets, favori marketler EN YENI BASTA (T11.13; MongoFavorites).
	FavoriteMarkets []favoriteDocument `bson:"favoriteMarkets,omitempty"`
	// Email, dogrulanmis e-posta (T11.14); yoksa alan yazilmaz ve benzersiz
	// indekse girmez (kismi indeks).
	Email           string     `bson:"email,omitempty"`
	EmailVerifiedAt *time.Time `bson:"emailVerifiedAt,omitempty"`
	// PhoneVerifiedAt, numaranin SMS koduyla dogrulandigi an (T11.14 PR 3).
	PhoneVerifiedAt *time.Time `bson:"phoneVerifiedAt,omitempty"`
}

// favoriteDocument, favori market: kimlik ve eklenme zamani.
type favoriteDocument struct {
	MarketID string    `bson:"marketId"`
	AddedAt  time.Time `bson:"addedAt"`
}

type sessionDocument struct {
	ID                string            `bson:"_id"`
	UserID            string            `bson:"userId"`
	TokenHash         string            `bson:"tokenHash"`
	CreatedAt         time.Time         `bson:"createdAt"`
	RefreshedAt       time.Time         `bson:"refreshedAt"`
	ExpiresAt         time.Time         `bson:"expiresAt"`
	IPAddress         string            `bson:"ipAddress,omitempty"`
	DeviceID          string            `bson:"deviceId,omitempty"`
	PreviousIPAddress string            `bson:"previousIpAddress,omitempty"`
	IPCity            string            `bson:"ipCity,omitempty"`
	Location          *geoPointDocument `bson:"location,omitempty"`
}

// geoPointDocument, konum. GeoJSON degil: konum uzerinde cografi sorgu yok,
// yalnizca risk sinyali olarak tasinir.
type geoPointDocument struct {
	Lat float64 `bson:"lat"`
	Lng float64 `bson:"lng"`
}

type addressDocument struct {
	// ID, defterdeki satirin kimligi (T11.15). T11.15 oncesi kayitlarda yok;
	// gateway'in 0001 gocu verir.
	ID        string           `bson:"id,omitempty"`
	Title     string           `bson:"title"`
	Kind      string           `bson:"kind,omitempty"`
	Line      string           `bson:"line"`
	Location  geoPointDocument `bson:"location"`
	Building  string           `bson:"building,omitempty"`
	Floor     string           `bson:"floor,omitempty"`
	Apartment string           `bson:"apartment,omitempty"`
	Note      string           `bson:"note,omitempty"`
}
