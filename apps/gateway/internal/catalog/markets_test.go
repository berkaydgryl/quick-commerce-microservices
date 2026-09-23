package catalog

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"
	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
)

// marketStub, pazaryeri RPC'lerini taklit eder ve gelen istegi saklar: adaptorun
// filtreleri servise dogru tasidigi dogrulanabilsin.
type marketStub struct {
	catalogv1.UnimplementedCatalogServiceServer
	nearby        []*catalogv1.NearbyMarket
	market        *catalogv1.Market
	offers        []*catalogv1.Offer
	page          *commonv1.PageResponse
	err           error
	trailer       metadata.MD
	gotNearby     *catalogv1.ListNearbyMarketsRequest
	gotProducts   *catalogv1.ListProductsRequest
	gotCategories *catalogv1.ListMarketCategoriesRequest
}

func (s *marketStub) fail(ctx context.Context) error {
	if s.trailer != nil {
		if err := grpc.SetTrailer(ctx, s.trailer); err != nil {
			return err
		}
	}
	return s.err
}

func (s *marketStub) ListNearbyMarkets(ctx context.Context, in *catalogv1.ListNearbyMarketsRequest) (*catalogv1.ListNearbyMarketsResponse, error) {
	s.gotNearby = in
	if s.err != nil {
		return nil, s.fail(ctx)
	}
	return &catalogv1.ListNearbyMarketsResponse{Markets: s.nearby}, nil
}

func (s *marketStub) GetMarket(ctx context.Context, _ *catalogv1.GetMarketRequest) (*catalogv1.GetMarketResponse, error) {
	if s.err != nil {
		return nil, s.fail(ctx)
	}
	return &catalogv1.GetMarketResponse{Market: s.market}, nil
}

func (s *marketStub) ListMarketCategories(ctx context.Context, in *catalogv1.ListMarketCategoriesRequest) (*catalogv1.ListMarketCategoriesResponse, error) {
	s.gotCategories = in
	if s.err != nil {
		return nil, s.fail(ctx)
	}
	return &catalogv1.ListMarketCategoriesResponse{Categories: []*catalogv1.Category{{Id: "cat_meyve-sebze", Name: "Meyve & Sebze", Slug: "meyve-sebze", SortOrder: 2}}}, nil
}

func (s *marketStub) ListProducts(ctx context.Context, in *catalogv1.ListProductsRequest) (*catalogv1.ListProductsResponse, error) {
	s.gotProducts = in
	if s.err != nil {
		return nil, s.fail(ctx)
	}
	return &catalogv1.ListProductsResponse{Offers: s.offers, Page: s.page}, nil
}

func migrosJet() *catalogv1.Market {
	return &catalogv1.Market{
		Id: "mkt_migros-jet-moda", Name: "Migros Jet Moda", Brand: "Migros Jet",
		LogoUrl:              "/img/market/migros-jet.png",
		Location:             &commonv1.GeoPoint{Lat: 40.98, Lng: 29.03},
		DeliveryRadiusMeters: 2500, IsOpen: true,
		DeliveryTime: &catalogv1.DeliveryTime{MinMinutes: 15, MaxMinutes: 25},
		Rating:       &catalogv1.Rating{AverageTenths: 47, Count: 1200},
		PricingRules: &catalogv1.PricingRules{
			MinBasket:             &commonv1.Money{AmountMinor: 4000},
			DeliveryFee:           &commonv1.Money{AmountMinor: 1999, Currency: "TRY"},
			FreeDeliveryThreshold: &commonv1.Money{AmountMinor: 25000},
		},
	}
}

func TestNearbyMarketsMapsContractShape(t *testing.T) {
	stub := &marketStub{nearby: []*catalogv1.NearbyMarket{{Market: migrosJet(), DistanceMeters: 500}}}
	service := startStub(t, stub)

	list, err := service.NearbyMarkets(context.Background(), 40.99, 29.02)
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	// Puan onda birden ondaliga (47 -> 4.7), bos para birimi TRY'ye, goreli
	// logo mutlak URL'ye cevrilir; alan adlari sozlesmedeki camelCase.
	encoded, _ := json.Marshal(list)
	want := `{"items":[{"market":{"id":"mkt_migros-jet-moda","name":"Migros Jet Moda","brand":"Migros Jet",` +
		`"logoUrl":"https://cdn.example/img/market/migros-jet.png","location":{"lat":40.98,"lng":29.03},` +
		`"deliveryRadiusMeters":2500,"isOpen":true,"deliveryTime":{"minMinutes":15,"maxMinutes":25},` +
		`"rating":{"average":4.7,"count":1200},"pricingRules":{"minBasket":{"amountMinor":4000,"currency":"TRY"},` +
		`"deliveryFee":{"amountMinor":1999,"currency":"TRY"},"freeDeliveryThreshold":{"amountMinor":25000,"currency":"TRY"}}},` +
		`"distanceMeters":500}]}`
	if string(encoded) != want {
		t.Errorf("JSON:\n got %s\nwant %s", encoded, want)
	}
	if loc := stub.gotNearby.GetLocation(); loc.GetLat() != 40.99 || loc.GetLng() != 29.02 {
		t.Errorf("konum servise tasinmadi: %v", loc)
	}
}

func TestNearbyMarketsEmptyIsArrayNotNull(t *testing.T) {
	// Yazlik adresi: hicbir marketin yaricapinda degil. Hata DEGIL, bos liste.
	service := startStub(t, &marketStub{})

	list, err := service.NearbyMarkets(context.Background(), 41.17, 29.61)
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if encoded, _ := json.Marshal(list); string(encoded) != `{"items":[]}` {
		t.Errorf("bos liste [] olmali, %s geldi", encoded)
	}
}

func TestMarketNotFoundComesFromTrailer(t *testing.T) {
	service := startStub(t, &marketStub{
		err:     status.Error(codes.NotFound, "yok"),
		trailer: metadata.Pairs(apperror.MetadataKey, `{"code":"NOT_FOUND","message":"yok","details":{"marketId":"mkt_yok"}}`),
	})

	_, err := service.Market(context.Background(), "mkt_yok")

	appErr := appErrorOf(t, err)
	if appErr.Code != apperror.CodeNotFound || appErr.Details["marketId"] != "mkt_yok" {
		t.Errorf("NOT_FOUND + marketId bekleniyordu: %+v", appErr)
	}
}

func TestMarketEmptyResponseIsInternal(t *testing.T) {
	// Basarili ama bos cevap: istemciye "id":"" olan bir market GITMEMELI.
	service := startStub(t, &marketStub{})

	_, err := service.Market(context.Background(), "mkt_migros-jet-moda")

	if code := appErrorOf(t, err).Code; code != apperror.CodeInternal {
		t.Errorf("INTERNAL bekleniyordu, %s geldi", code)
	}
}

func TestMarketCategoriesForwardsMarketID(t *testing.T) {
	stub := &marketStub{}
	service := startStub(t, stub)

	list, err := service.MarketCategories(context.Background(), "mkt_kardesler-manavi")
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if stub.gotCategories.GetMarketId() != "mkt_kardesler-manavi" || len(list.Items) != 1 {
		t.Errorf("market kimligi tasinmadi ya da liste bos: %v %+v", stub.gotCategories, list)
	}
}

func TestMarketProductsMapsOfferAndOmitsStock(t *testing.T) {
	stub := &marketStub{
		offers: []*catalogv1.Offer{{
			Id: "ofr_migros-jet-moda-sut-1l", MarketId: "mkt_migros-jet-moda", ProductId: "prd_sut-1l",
			Sku: "SUT-1L", Name: "Süt 1 L", CategoryId: "cat_sut-kahvaltilik",
			Unit: commonv1.Unit_UNIT_LITER, Price: &commonv1.Money{AmountMinor: 4599},
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

	// id = ORTAK urun kimligi, offerId = bu marketin satisi. Stok bilgisi yok:
	// availableQuantity alani HIC yazilmaz (0 degil). Bos aciklama ve gorsel de yazilmaz.
	encoded, _ := json.Marshal(page)
	want := `{"items":[{"id":"prd_sut-1l","offerId":"ofr_migros-jet-moda-sut-1l","marketId":"mkt_migros-jet-moda",` +
		`"sku":"SUT-1L","name":"Süt 1 L","categoryId":"cat_sut-kahvaltilik","price":{"amountMinor":4599,"currency":"TRY"},` +
		`"unit":"LITER"}],"page":{"nextPageToken":"sonraki","totalSize":0}}`
	if string(encoded) != want {
		t.Errorf("JSON:\n got %s\nwant %s", encoded, want)
	}
	if strings.Contains(string(encoded), "availableQuantity") {
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
	if encoded, _ := json.Marshal(page); strings.Contains(string(encoded), `"unit"`) {
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

	details := appErrorOf(t, err).Details
	if details["q"] != "en az 2 karakter olmali" || details["marketId"] != "zorunlu" {
		t.Errorf("proto alan adi REST adina cevrilmeli, digerleri korunmali: %v", details)
	}
	if _, stale := details["query"]; stale {
		t.Errorf("proto alan adi (query) kalmamali: %v", details)
	}
}

func TestNearbyMarketsRenamesLocationFields(t *testing.T) {
	service := startStub(t, &marketStub{
		err:     status.Error(codes.InvalidArgument, "gecersiz"),
		trailer: metadata.Pairs(apperror.MetadataKey, `{"code":"VALIDATION_FAILED","message":"x","details":{"location.lat":"en fazla 90"}}`),
	})

	_, err := service.NearbyMarkets(context.Background(), 91, 29)

	if details := appErrorOf(t, err).Details; details["lat"] != "en fazla 90" {
		t.Errorf("location.lat -> lat bekleniyordu: %v", details)
	}
}
