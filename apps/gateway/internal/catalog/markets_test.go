package catalog

import (
	"context"
	"strings"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"
	commonv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/common/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/apperror"
	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
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
	batch         []*catalogv1.Market
	gotBatch      *catalogv1.BatchGetMarketsRequest
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

func (s *marketStub) BatchGetMarkets(ctx context.Context, in *catalogv1.BatchGetMarketsRequest) (*catalogv1.BatchGetMarketsResponse, error) {
	s.gotBatch = in
	if s.err != nil {
		return nil, s.fail(ctx)
	}
	return &catalogv1.BatchGetMarketsResponse{Markets: s.batch, Missing: []string{"mkt_yok"}}, nil
}

func (s *marketStub) ListMarketCategories(ctx context.Context, in *catalogv1.ListMarketCategoriesRequest) (*catalogv1.ListMarketCategoriesResponse, error) {
	s.gotCategories = in
	if s.err != nil {
		return nil, s.fail(ctx)
	}
	return &catalogv1.ListMarketCategoriesResponse{Categories: []*catalogv1.Category{{Id: "cat_meyve-sebze", Name: "Meyve & Sebze", Slug: "meyve-sebze", SortOrder: 2}}}, nil
}

func migrosJet() *catalogv1.Market {
	return &catalogv1.Market{
		Id: "mkt_migros-jet-moda", Name: "Migros Jet Moda", Brand: "Migros Jet",
		LogoUrl:              "/img/market/migros-jet.png",
		StoreType:            catalogv1.StoreType_STORE_TYPE_MARKET,
		CoverUrl:             "/img/market/market.jpg",
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

// migrosJetJSON, migrosJet()'in REST bicimi: puan onda birden ondaliga
// (47 -> 4.7), bos para birimi TRY'ye, goreli logo ve kapak mutlak URL'ye,
// dukkan turu enum adindan sozlesme metnine cevrilir; alan adlari
// sozlesmedeki camelCase.
const migrosJetJSON = `{"id":"mkt_migros-jet-moda","name":"Migros Jet Moda","brand":"Migros Jet",` +
	`"logoUrl":"https://cdn.example/img/market/migros-jet.png","storeType":"MARKET",` +
	`"coverUrl":"https://cdn.example/img/market/market.jpg","location":{"lat":40.98,"lng":29.03},` +
	`"deliveryRadiusMeters":2500,"isOpen":true,"deliveryTime":{"minMinutes":15,"maxMinutes":25},` +
	`"rating":{"average":4.7,"count":1200},"pricingRules":{"minBasket":{"amountMinor":4000,"currency":"TRY"},` +
	`"deliveryFee":{"amountMinor":1999,"currency":"TRY"},"freeDeliveryThreshold":{"amountMinor":25000,"currency":"TRY"}}}`

func TestNearbyMarketsMapsContractShape(t *testing.T) {
	stub := &marketStub{nearby: []*catalogv1.NearbyMarket{{Market: migrosJet(), DistanceMeters: 500}}}
	service := startStub(t, stub)

	list, err := service.NearbyMarkets(context.Background(), 40.99, 29.02)
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	encoded := testkit.JSON(t, list)
	want := `{"items":[{"market":` + migrosJetJSON + `,"distanceMeters":500}]}`
	if encoded != want {
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
	if encoded := testkit.JSON(t, list); encoded != `{"items":[]}` {
		t.Errorf("bos liste [] olmali, %s geldi", encoded)
	}
}

func TestMarketNotFoundComesFromTrailer(t *testing.T) {
	service := startStub(t, &marketStub{
		err:     status.Error(codes.NotFound, "yok"),
		trailer: metadata.Pairs(apperror.MetadataKey, `{"code":"NOT_FOUND","message":"yok","details":{"marketId":"mkt_yok"}}`),
	})

	_, err := service.Market(context.Background(), "mkt_yok")

	appErr := testkit.AppErrorOf(t, err)
	if appErr.Code != apperror.CodeNotFound || appErr.Details["marketId"] != "mkt_yok" {
		t.Errorf("NOT_FOUND + marketId bekleniyordu: %+v", appErr)
	}
}

func TestMarketEmptyResponseIsInternal(t *testing.T) {
	// Basarili ama bos cevap: istemciye "id":"" olan bir market GITMEMELI.
	service := startStub(t, &marketStub{})

	_, err := service.Market(context.Background(), "mkt_migros-jet-moda")

	if code := testkit.AppErrorOf(t, err).Code; code != apperror.CodeInternal {
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

func TestNearbyMarketsRenamesLocationFields(t *testing.T) {
	service := startStub(t, &marketStub{
		err:     status.Error(codes.InvalidArgument, "gecersiz"),
		trailer: metadata.Pairs(apperror.MetadataKey, `{"code":"VALIDATION_FAILED","message":"x","details":{"location.lat":"en fazla 90"}}`),
	})

	_, err := service.NearbyMarkets(context.Background(), 91, 29)

	if details := testkit.AppErrorOf(t, err).Details; details["lat"] != "en fazla 90" {
		t.Errorf("location.lat -> lat bekleniyordu: %v", details)
	}
}

func TestMarketWithoutStoreTypeOrCoverOmitsFields(t *testing.T) {
	// Eski catalog-service turu ve kapagi gondermez (UNSPECIFIED, ""); gateway'in
	// tanimadigi yeni tur de ayni kalir: sozlesme alanlari istege baglidir.
	for _, storeType := range []catalogv1.StoreType{catalogv1.StoreType_STORE_TYPE_UNSPECIFIED, catalogv1.StoreType(99)} {
		market := migrosJet()
		market.StoreType = storeType
		market.CoverUrl = ""
		market.LogoUrl = ""

		got := toMarket(market, testResolver(t))
		if got.StoreType != "" || got.CoverURL != "" || got.LogoURL != "" {
			t.Errorf("tur %d: alanlar bos kalmali, %+v geldi", storeType, got)
		}
		encoded := testkit.JSON(t, got)
		for _, field := range []string{`"storeType"`, `"coverUrl"`, `"logoUrl"`} {
			if strings.Contains(encoded, field) {
				t.Errorf("tur %d: %s yazilmamali: %s", storeType, field, encoded)
			}
		}
	}
}

func TestMarketsByIDsIsOneCallAndMapsTheContractShape(t *testing.T) {
	// T11.13: favori sayfasi butun marketleri TEK cagriyla ister; kapak mutlak URL.
	stub := &marketStub{batch: []*catalogv1.Market{migrosJet()}}
	service := startStub(t, stub)

	markets, err := service.MarketsByIDs(context.Background(), []string{"mkt_migros-jet-moda", "mkt_yok"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if got := stub.gotBatch.GetMarketIds(); len(got) != 2 || got[1] != "mkt_yok" {
		t.Errorf("kimlikler servise tasinmali: %v", got)
	}
	if encoded := testkit.JSON(t, markets); encoded != "["+migrosJetJSON+"]" {
		t.Errorf("JSON:\n got %s\nwant [%s]", encoded, migrosJetJSON)
	}
}

func TestMarketsByIDsWithoutIDsSkipsTheCall(t *testing.T) {
	stub := &marketStub{}
	service := startStub(t, stub)

	markets, err := service.MarketsByIDs(context.Background(), nil)
	if err != nil || len(markets) != 0 || stub.gotBatch != nil {
		t.Errorf("bos liste cagri yapmadan [] donmeli: %v %v %v", markets, err, stub.gotBatch)
	}
	if encoded := testkit.JSON(t, markets); encoded != "[]" {
		t.Errorf("bos liste [] olmali: %s", encoded)
	}
}
