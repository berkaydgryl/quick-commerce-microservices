package order

import (
	"errors"
	"strings"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// order-service'in dogrulama hatasi (VALIDATION_FAILED; digerlerine dokunulmaz,
// bkz. rpc.RenameFields) proto alan YOLUNU tasir ("lines.0.quantity",
// "deliveryLocation.lat"). Istemci hatayi kendi gonderdigi adla gormeli: REST
// govdesinde "lines" degil "items", "deliveryLocation" degil "address.location"
// var; anahtar ise baslikta ("Idempotency-Key"), siparis kimligi yolda ("id").
// Eslemesi olmayan ad oldugu gibi kalir.

const idempotencyKeyField = "Idempotency-Key"

// reserveFieldNames, CreateDraftOrder -> POST /v1/cart/reserve.
var reserveFieldNames = renamer(
	map[string]string{
		"lines":                "items",
		"deliveryLocation":     "address.location",
		"deliveryLocation.lat": "address.location.lat",
		"deliveryLocation.lng": "address.location.lng",
		"deliveryAddress":      "address.line",
		"idempotencyKey":       idempotencyKeyField,
	},
	// Kalem hatalari dizinle gelir: "lines.3.quantity" -> "items.3.quantity".
	map[string]string{"lines.": "items."},
)

// placeFieldNames, CreateOrder -> POST /v1/orders.
var placeFieldNames = renamer(
	map[string]string{
		"paymentMethod":  "payment.method",
		"cardToken":      "payment.cardToken",
		"cardId":         "payment.cardId",
		"onDelivery":     "payment.onDelivery",
		"idempotencyKey": idempotencyKeyField,
	},
	// Ayrinti hatalari (T12.4) REST'teki adlariyla ayni gelir: "details.gift.recipientPhone".
	nil,
)

// confirmFieldNames, ConfirmPayment -> POST /v1/orders/{id}/3ds.
var confirmFieldNames = renamer(
	map[string]string{
		"orderId":        "id",
		"code":           "otp",
		"idempotencyKey": idempotencyKeyField,
	},
	nil,
)

// releaseFieldNames, CancelOrder -> DELETE /v1/cart/reserve/{orderId}: yol
// parametresinin REST adi orderId (openapi OrderIdPath).
var releaseFieldNames = renamer(
	map[string]string{"idempotencyKey": idempotencyKeyField},
	nil,
)

// getFieldNames, GetOrder -> GET /v1/orders/{id}.
var getFieldNames = renamer(map[string]string{"orderId": "id"}, nil)

// listFieldNames, ListMyOrders -> GET /v1/orders (T11.16): sayfa alanlari
// sorgu parametresidir.
var listFieldNames = renamer(
	map[string]string{"page.pageToken": "pageToken", "page.pageSize": "pageSize"},
	nil,
)

// renamer, tam ad ve onek eslemesinden bir ad cevirici kurar. Tam ad once
// denenir; sonra onekler (proto'nun dizinli yolu icin).
func renamer(names, prefixes map[string]string) func(string) string {
	return func(field string) string {
		if restName, ok := names[field]; ok {
			return restName
		}
		for protoPrefix, restPrefix := range prefixes {
			if remainder, found := strings.CutPrefix(field, protoPrefix); found {
				return restPrefix + remainder
			}
		}
		return field
	}
}

// renameConflictField, order'in CONFLICT'indeki degisen alanin (details.field,
// T12.4: odeme bekleyen sipariste yontem ya da tur degisti) proto adini REST
// adina cevirir: "paymentMethod" -> "payment.method". Diger hatalara dokunmaz.
func renameConflictField(err error, rename func(string) string) error {
	var appErr *apperror.Error
	if !errors.As(err, &appErr) || appErr.Code != apperror.CodeConflict {
		return err
	}
	field, isText := appErr.Details["field"].(string)
	if !isText {
		return err
	}
	// Kopya: rpc.RenameFields gibi asil hatayi DEGISTIRMEZ.
	renamed := make(map[string]any, len(appErr.Details))
	for key, value := range appErr.Details {
		renamed[key] = value
	}
	renamed["field"] = rename(field)
	return &apperror.Error{Code: appErr.Code, Details: renamed, Cause: appErr.Cause}
}
