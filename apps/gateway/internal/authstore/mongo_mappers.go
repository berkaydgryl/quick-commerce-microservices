package authstore

import (
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
)

func toUserDocument(user auth.User) userDocument {
	doc := userDocument{
		ID: user.ID, Phone: user.Phone, PasswordHash: user.PasswordHash, FullName: user.FullName, CreatedAt: user.CreatedAt,
		RegistrationDeviceID: user.RegistrationDeviceID, LastLoginIP: user.LastLoginIP,
		LastLocation: toGeoPointDocumentPtr(user.LastLocation), Email: user.Email,
	}
	if !user.EmailVerifiedAt.IsZero() {
		verifiedAt := user.EmailVerifiedAt
		doc.EmailVerifiedAt = &verifiedAt
	}
	if !user.PhoneVerifiedAt.IsZero() {
		verifiedAt := user.PhoneVerifiedAt
		doc.PhoneVerifiedAt = &verifiedAt
	}
	for _, address := range user.Addresses {
		doc.Addresses = append(doc.Addresses, toAddressDocument(address))
	}
	return doc
}

func toAddressDocument(address auth.SavedAddress) addressDocument {
	return addressDocument{
		ID: address.ID, Title: address.Title, Kind: address.Kind, Line: address.Line, Location: toGeoPointDocument(address.Location),
		Building: address.Building, Floor: address.Floor, Apartment: address.Apartment, Note: address.Note,
	}
}

func fromAddressDocument(doc addressDocument) auth.SavedAddress {
	return auth.SavedAddress{
		ID: doc.ID, Title: doc.Title, Kind: doc.Kind, Line: doc.Line, Location: auth.GeoPoint(doc.Location),
		Building: doc.Building, Floor: doc.Floor, Apartment: doc.Apartment, Note: doc.Note,
	}
}

func fromUserDocument(doc userDocument) auth.User {
	user := auth.User{
		ID: doc.ID, Phone: doc.Phone, PasswordHash: doc.PasswordHash, FullName: doc.FullName, CreatedAt: doc.CreatedAt,
		RegistrationDeviceID: doc.RegistrationDeviceID, LastLoginIP: doc.LastLoginIP,
		LastLocation: fromGeoPointDocument(doc.LastLocation), Email: doc.Email,
	}
	if doc.EmailVerifiedAt != nil {
		user.EmailVerifiedAt = doc.EmailVerifiedAt.UTC()
	}
	if doc.PhoneVerifiedAt != nil {
		user.PhoneVerifiedAt = doc.PhoneVerifiedAt.UTC()
	}
	for _, address := range doc.Addresses {
		user.Addresses = append(user.Addresses, fromAddressDocument(address))
	}
	return user
}

func toSessionDocument(session auth.Session) sessionDocument {
	return sessionDocument{
		ID: session.ID, UserID: session.UserID, TokenHash: session.TokenHash, CreatedAt: session.CreatedAt,
		RefreshedAt: session.RefreshedAt, ExpiresAt: session.ExpiresAt, IPAddress: session.IPAddress,
		DeviceID: session.DeviceID, PreviousIPAddress: session.PreviousIPAddress, IPCity: session.IPCity,
		Location: toGeoPointDocumentPtr(session.Location),
	}
}

func fromSessionDocument(doc sessionDocument) auth.Session {
	return auth.Session{
		ID: doc.ID, UserID: doc.UserID, TokenHash: doc.TokenHash, CreatedAt: doc.CreatedAt,
		RefreshedAt: doc.RefreshedAt, ExpiresAt: doc.ExpiresAt, IPAddress: doc.IPAddress,
		DeviceID: doc.DeviceID, PreviousIPAddress: doc.PreviousIPAddress, IPCity: doc.IPCity,
		Location: fromGeoPointDocument(doc.Location),
	}
}

func toGeoPointDocument(point auth.GeoPoint) geoPointDocument {
	return geoPointDocument(point)
}

// toGeoPointDocumentPtr, istege bagli konum; nil ise alan yazilmaz (omitempty).
func toGeoPointDocumentPtr(point *auth.GeoPoint) *geoPointDocument {
	if point == nil {
		return nil
	}
	doc := toGeoPointDocument(*point)
	return &doc
}

// fromGeoPointDocument, belgedeki konum; alan yoksa nil.
func fromGeoPointDocument(doc *geoPointDocument) *auth.GeoPoint {
	if doc == nil {
		return nil
	}
	point := auth.GeoPoint(*doc)
	return &point
}
