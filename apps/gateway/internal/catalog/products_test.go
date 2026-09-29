package catalog

import (
	"context"
	"strings"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"
	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

func (s *marketStub) ListProducts(ctx context.Context, in *catalogv1.ListProductsRequest) (*catalogv1.ListProductsResponse, error) {
	s.gotProducts = in
	if s.err != nil {
		return nil, s.fail(ctx)
	}
	return &catalogv1.ListProductsResponse{Offers: s.offers, Page: s.page}, nil
}

func TestMarketProductsMapsOfferAndOmitsStock(t *testing.T) {
	stub := &marketStub{
		offers: []*catalogv1.Offer{{
			Id: "ofr_migros-jet-moda-sut-1l", MarketId: "mkt_migros-jet-moda", ProductId: "prd_sut-1l",
			Sku: "SUT-1L", Name: "Süt 1 L", CategoryId: "cat_sut-kahvaltilik",
			Unit: commonv1.Unit_UNIT_LITER, Price: &commonv1.Money{AmountMinor: 4599}, IsActive: true,
		}},
		page: &commonv1.PageResponse{NextPageToken: "sonraki"},
	}
	service := startStub(t, stub)

	page, err := service.MarketProducts(context.Background(), ProductQuery{
		MarketID: "mkt_migros-jet-moda", CategoryID: "cat_sut-kahvaltilik", Query: "süt", PageSize: 20, PageToken: "t1",
	})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	// id = ORTAK urun kimligi, offerId = bu marketin satisi. Katalog adaptoru
	// stok yazmaz (storefront ekler): availableQuantity alani HIC yazilmaz (0
	// degil). Bos aciklama ve gorsel de yazilmaz.
	encoded := testkit.JSON(t, page)
	want := `{"items":[{"id":"prd_sut-1l","offerId":"ofr_migros-jet-moda-sut-1l","marketId":"mkt_migros-jet-moda",` +
		`"sku":"SUT-1L","name":"Süt 1 L","categoryId":"cat_sut-kahvaltilik","price":{"amountMinor":4599,"currency":"TRY"},` +
		`"unit":"LITER","isActive":true}],"page":{"nextPageToken":"sonraki","totalSize":0}}`
	if encoded != want {
		t.Errorf("JSON:\n got %s\nwant %s", encoded, want)
	}
	if strings.Contains(encoded, "availableQuantity") {
		t.Error("stok bilgisi yokken availableQuantity yazilmamali")
	}

	got := stub.gotProducts
	if got.GetMarketId() != "mkt_migros-jet-moda" || got.GetCategoryId() != "cat_sut-kahvaltilik" ||
		got.GetQuery() != "süt" || got.GetPage().GetPageSize() != 20 || got.GetPage().GetPageToken() != "t1" {
		t.Errorf("filtreler servise tasinmadi: %v", got)
	}
}

func TestMarketProductsUnspecifiedUnitIsOmitted(t *testing.T) {
	service := startStub(t, &marketStub{offers: []*catalogv1.Offer{{Id: "ofr_x", ProductId: "prd_x"}}})

	page, err := service.MarketProducts(context.Background(), ProductQuery{MarketID: "mkt_x"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if encoded := testkit.JSON(t, page); strings.Contains(encoded, `"unit"`) {
		t.Errorf("bilinmeyen birim yazilmamali: %s", encoded)
	}
}

func TestMarketProductsRenamesProtoFieldsInErrors(t *testing.T) {
	// Istemci ?q=s gonderdi; hata "query" degil "q" demeli.
	service := startStub(t, &marketStub{
		err:     status.Error(codes.InvalidArgument, "gecersiz"),
		trailer: metadata.Pairs(apperror.MetadataKey, `{"code":"VALIDATION_FAILED","message":"x","details":{"query":"en az 2 karakter olmali","marketId":"zorunlu"}}`),
	})

	_, err := service.MarketProducts(context.Background(), ProductQuery{MarketID: "mkt_x", Query: "s"})

	details := testkit.AppErrorOf(t, err).Details
	if details["q"] != "en az 2 karakter olmali" || details["marketId"] != "zorunlu" {
		t.Errorf("proto alan adi REST adina cevrilmeli, digerleri korunmali: %v", details)
	}
	if _, stale := details["query"]; stale {
		t.Errorf("proto alan adi (query) kalmamali: %v", details)
	}
}

func TestMarketProductsCarriesInactiveOffer(t *testing.T) {
	// T7.6: pasif teklif listede kalir ama "isActive":false ACIKCA yazilir;
	// alan hic yazilmasaydi istemci "satista degil" ile "bilinmiyor"u ayiramazdi.
	service := startStub(t, &marketStub{offers: []*catalogv1.Offer{{Id: "ofr_x", ProductId: "prd_x", IsActive: false}}})

	page, err := service.MarketProducts(context.Background(), ProductQuery{MarketID: "mkt_x"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if encoded := testkit.JSON(t, page); !strings.Contains(encoded, `"isActive":false`) {
		t.Errorf("pasif teklif isActive:false tasimali: %s", encoded)
	}
}
