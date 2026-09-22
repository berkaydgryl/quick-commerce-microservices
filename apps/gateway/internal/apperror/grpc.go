package apperror

import (
	"encoding/json"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// MetadataKey, Node servislerinin hatayi tasidigi trailer anahtari
// (service-kit: ERROR_METADATA_KEY). Deger AppError'in JSON halidir.
const MetadataKey = "x-app-error"

// wirePayload, x-app-error yukunun bize lazim olan kismi.
type wirePayload struct {
	Code    string          `json:"code"`
	Message string          `json:"message"`
	Details json.RawMessage `json:"details"`
}

// FromGRPC, bagimli servis cagrisinin hatasini gateway hatasina cevirir.
//
// Oncelik x-app-error yukundedir: servis hatanin IS anlamini (STOCK_INSUFFICIENT)
// orada tasir; gRPC durum kodu (FAILED_PRECONDITION) o ayrimi yapamaz. Yuk yoksa ya
// da bozuksa durum kodundan en yakin kod turetilir.
//
// trailer, cagrida grpc.Trailer(&md) ile toplanan metadata'dir.
func FromGRPC(err error, trailer metadata.MD) *Error {
	if payload, ok := decodePayload(trailer); ok {
		return &Error{Code: Code(payload.Code), Details: decodeDetails(payload.Details), Cause: err}
	}
	return &Error{Code: codeForStatus(status.Code(err)), Cause: err}
}

func decodePayload(trailer metadata.MD) (wirePayload, bool) {
	values := trailer.Get(MetadataKey)
	if len(values) == 0 {
		return wirePayload{}, false
	}

	var payload wirePayload
	if err := json.Unmarshal([]byte(values[0]), &payload); err != nil {
		// Bozuk yuk, hatanin kendisini gizlemeye degmez: durum kodundan devam.
		return wirePayload{}, false
	}
	if !Known(Code(payload.Code)) {
		return wirePayload{}, false
	}
	return payload, true
}

// decodeDetails, ayrintiyi alan -> metin haritasina indirir.
//
// Sozlesme ayrintiyi string->string tutar (getir.common.v1.ErrorDetail.metadata)
// ve REST zarfi bir NESNE bekler. Nesne olmayan (dizi, sayi) ya da metin
// olmayan degerler tasiyan ayrinti DUSURULUR: zarfi bozmaktansa baglamsiz hata
// daha iyidir, asil yuk zaten gunluktedir.
func decodeDetails(raw json.RawMessage) map[string]string {
	if len(raw) == 0 {
		return nil
	}
	var details map[string]string
	if err := json.Unmarshal(raw, &details); err != nil || len(details) == 0 {
		return nil
	}
	return details
}

// codeForStatus, x-app-error yokken durum kodundan hata kodu turetir.
//
// service-kit/src/grpc/status.ts icindeki errorCodeForStatus ile AYNI esleme;
// ikisi ayrisirsa ayni hata Node'dan Node'a baska, gateway'den baska gorunur.
func codeForStatus(code codes.Code) Code {
	switch code {
	case codes.InvalidArgument, codes.OutOfRange:
		return CodeValidationFailed
	case codes.Unauthenticated:
		return CodeUnauthorized
	case codes.PermissionDenied:
		return CodeForbidden
	case codes.NotFound:
		return CodeNotFound
	case codes.AlreadyExists, codes.Aborted:
		return CodeConflict
	case codes.ResourceExhausted:
		return CodeRateLimited
	// Servis kapali, deadline doldu ya da cagri iptal edildi: ucu de "su an
	// cevap alamadik" demektir ve yeniden denenebilir.
	case codes.Unavailable, codes.DeadlineExceeded, codes.Canceled:
		return CodeServiceUnavailable
	default:
		return CodeInternal
	}
}
