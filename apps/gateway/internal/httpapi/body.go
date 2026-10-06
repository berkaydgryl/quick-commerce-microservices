package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// maxBodyBytes, istek govdesinin ust siniri. 50 kalemlik sepet yaklasik 5 KB;
// sinir sinirsiz govdenin bellege alinmasini onler (Fiber varsayilani 4 MB).
const maxBodyBytes = 64 * 1024

const (
	bodyField          = "body"
	contentTypeField   = "Content-Type"
	unknownFieldReason = "bu uc bu alani kabul etmiyor"
	invalidJSONReason  = "gecersiz JSON"
	singleValueReason  = "tek bir JSON nesnesi olmali"
	jsonContentReason  = "application/json olmali"
)

// decodeJSONBody, govdeyi hedef yapiya KATI cozer. Bozuk JSON, bilinmeyen alan
// ve yanlis tip 400 VALIDATION_FAILED olur; details alan adini tasir.
//
// NEDEN BILINMEYEN ALANI REDDEDIYORUZ: sorgu parametresindeki kuralla ayni
// (query.go). Sozlesmede olmayan bir alan (ornek adres etiketi "title")
// sessizce yok sayilirsa istemci onun kaydedildigini sanir.
func decodeJSONBody(c fiber.Ctx, target any) error {
	contentType := strings.ToLower(c.Get(fiber.HeaderContentType))
	if !strings.HasPrefix(contentType, fiber.MIMEApplicationJSON) {
		return apperror.New(apperror.CodeValidationFailed, map[string]string{contentTypeField: jsonContentReason})
	}

	decoder := json.NewDecoder(bytes.NewReader(c.Body()))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return bodyError(err)
	}
	// Tek JSON degeri: arkasindan gelen ikinci deger ya da cop kabul edilmez.
	var extra json.RawMessage
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return &apperror.Error{
			Code:    apperror.CodeValidationFailed,
			Details: map[string]any{bodyField: singleValueReason},
			Cause:   safeDecodeCause(err),
		}
	}
	return nil
}

// bodyError, cozme hatasini alan adli bir dogrulama hatasina cevirir.
func bodyError(err error) error {
	details := map[string]any{bodyField: invalidJSONReason}

	var typeErr *json.UnmarshalTypeError
	switch {
	case errors.Is(err, io.EOF):
		details = map[string]any{bodyField: requiredReason}
	case errors.As(err, &typeErr) && typeErr.Field != "":
		details = map[string]any{typeErr.Field: expectedTypeReason(typeErr.Type)}
	default:
		if field, ok := unknownField(err); ok {
			details = map[string]any{field: unknownFieldReason}
		}
	}
	return &apperror.Error{Code: apperror.CodeValidationFailed, Details: details, Cause: safeDecodeCause(err)}
}

// safeDecodeCause, cozme hatasinin gunluge giden hali (T11.17, QA L4): girilen
// DEGER yazilmaz. encoding/json tip hatasinda degeri mesaja koyar ("cannot
// unmarshal number 4242424242424242 into ..."); kart numarasi yanlis alana
// yazilirsa gunluge sizardi. Yalnizca alan ve beklenen tip kalir.
func safeDecodeCause(err error) error {
	var typeErr *json.UnmarshalTypeError
	if errors.As(err, &typeErr) {
		return fmt.Errorf("json: %q alani %v tipine cozulemedi", typeErr.Field, typeErr.Type)
	}
	return err
}

// unknownField, DisallowUnknownFields hatasindaki alan adi. encoding/json bu
// hata icin tip disa vermez; mesaj bicimi `json: unknown field "ad"`.
func unknownField(err error) (string, bool) {
	quoted, found := strings.CutPrefix(err.Error(), "json: unknown field ")
	if !found {
		return "", false
	}
	field, unquoteErr := strconv.Unquote(quoted)
	if unquoteErr != nil {
		return "", false
	}
	return field, true
}

// expectedTypeReason, beklenen JSON tipini soyler ("sayi olmali").
func expectedTypeReason(expected reflect.Type) string {
	// Istege bagli alanlar isaretcidir (*float64): istemci icin tip, isaret edilen tiptir.
	for expected.Kind() == reflect.Pointer {
		expected = expected.Elem()
	}
	switch expected.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return integerReason
	case reflect.Float32, reflect.Float64:
		return numberReason
	case reflect.String:
		return "metin olmali"
	case reflect.Bool:
		return "true ya da false olmali"
	case reflect.Slice, reflect.Array:
		return "dizi olmali"
	default:
		return "nesne olmali"
	}
}
