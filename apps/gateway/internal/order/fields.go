package order

import "strings"

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
		"idempotencyKey": idempotencyKeyField,
	},
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
