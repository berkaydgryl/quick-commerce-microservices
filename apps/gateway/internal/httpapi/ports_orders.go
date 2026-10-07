package httpapi

import (
	"context"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/auth"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/order"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/orderhistory"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/roomtoken"
)

// CartReserver, POST /v1/cart/reserve.
type CartReserver interface {
	Reserve(ctx context.Context, input order.ReserveInput) (order.Reservation, error)
}

// ReservationReleaser, DELETE /v1/cart/reserve/{orderId} (T11.4).
type ReservationReleaser interface {
	Release(ctx context.Context, input order.ReleaseInput) (order.ReservationRelease, error)
}

// OrderPlacer, POST /v1/orders.
type OrderPlacer interface {
	Place(ctx context.Context, input order.PlaceInput) (order.Placement, error)
}

// ThreeDSConfirmer, POST /v1/orders/{id}/3ds.
type ThreeDSConfirmer interface {
	ConfirmThreeDS(ctx context.Context, input order.ConfirmInput) (order.Placement, error)
}

// OrderLister, GET /v1/orders (Gecmis Siparislerim, T11.16).
type OrderLister interface {
	List(ctx context.Context, userID string, pageSize int32, pageToken string) (orderhistory.List, error)
}

// OrderGetter, GET /v1/orders/{id}: siparis ve ayrintisi (T12.4), sahibine.
type OrderGetter interface {
	GetDetailed(ctx context.Context, userID, orderID string) (order.OrderDetail, error)
}

// OrderRoomTokenIssuer, GET /v1/orders/{id}/token (T12.2): siparis odasinin
// kisa omurlu jetonu; gercegi roomtoken.Service (sahiplik + imza).
type OrderRoomTokenIssuer interface {
	Issue(ctx context.Context, userID, orderID string) (roomtoken.Token, error)
}

// CheckoutSignalReader, POST /v1/orders'in risk sinyalleri (T8.1): oturum ve
// kullanici kaydindan; gercegi auth.Service.
type CheckoutSignalReader interface {
	CheckoutSignals(ctx context.Context, identity auth.Identity, ipAddress string) (auth.CheckoutSignals, error)
}
