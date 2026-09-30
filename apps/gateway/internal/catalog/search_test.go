package catalog

import (
	"context"
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

// searchStub, SearchNearby'yi taklit eder ve gelen istegi saklar.
type searchStub struct {
	catalogv1.UnimplementedCatalogServiceServer
	results []*catalogv1.MarketSearchResult
	err     error
	trailer metadata.MD
	got     *catalogv1.SearchNearbyRequest
}

func (s *searchStub) SearchNearby(ctx context.Context, in *catalogv1.SearchNearbyRequest) (*catalogv1.SearchNearbyResponse, error) {
	s.got = in
	if s.err != nil {
		if s.trailer != nil {
			if err := grpc.SetTrailer(ctx, s.trailer); err != nil {
				return nil, err
			}
		}
		return nil, s.err
	}
	return &catalogv1.SearchNearbyResponse{Results: s.results}, nil
}

func sutOffer() *catalogv1.Offer {
	return &catalogv1.Offer{
		Id: "ofr_migros-jet-moda-sut-1l", MarketId: "mkt_migros-jet-moda", ProductId: "prd_sut-1l",
		Sku: "SUT-1L", Name: "Süt 1 L", CategoryId: "cat_sut-kahvaltilik", ImageUrl: "/img/urun/sut-1l.png",
		Price: &commonv1.Money{AmountMinor: 3490, Currency: "TRY"}, Unit: commonv1.Unit_UNIT_LITER, IsActive: true,
	}
}

// sutJSON, sutOffer()'in REST bicimi: market sayfasindaki urunle AYNI; stok
// alani YOK (storefront ekler).
const sutJSON = `{"id":"prd_sut-1l","offerId":"ofr_migros-jet-moda-sut-1l","marketId":"mkt_migros-jet-moda",` +
	`"sku":"SUT-1L","name":"Süt 1 L","categoryId":"cat_sut-kahvaltilik","imageUrl":"https://cdn.example/img/urun/sut-1l.png",` +
	`"price":{"amountMinor":3490,"currency":"TRY"},"unit":"LITER","isActive":true}`

func TestSearchMapsContractShape(t *testing.T) {
	stub := &searchStub{results: []*catalogv1.MarketSearchResult{{
		Market:            &catalogv1.NearbyMarket{Market: migrosJet(), DistanceMeters: 405},
		Offers:            []*catalogv1.Offer{sutOffer()},
		TotalOfferMatches: 4,
	}}}
	service := startStub(t, stub)

	list, err := service.Search(context.Background(), SearchQuery{Lat: 40.9885, Lng: 29.0262, Query: "süt"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	// Yakindaki market satiri (market, distanceMeters) UST DUZEYDE: sozlesmedeki
	// nearbyMarketSchema.extend(...). Teklif "urun" adiyla, market sayfasindaki bicimde.
	encoded := testkit.JSON(t, list)
	want := `{"items":[{"market":` + migrosJetJSON + `,"distanceMeters":405,"marketNameMatched":false,` +
		`"products":[` + sutJSON + `],"totalProductMatches":4}]}`
	if encoded != want {
		t.Errorf("JSON:\n got %s\nwant %s", encoded, want)
	}
	if got := stub.got; got.GetLocation().GetLat() != 40.9885 || got.GetLocation().GetLng() != 29.0262 || got.GetQuery() != "süt" {
		t.Errorf("konum ve arama servise tasinmadi: %v", got)
	}
}

func TestSearchNameOnlyMatchHasEmptyProductsArray(t *testing.T) {
	// "migros": market adi eslesti, urun yok. Urun listesi [] olmali, null DEGIL.
	service := startStub(t, &searchStub{results: []*catalogv1.MarketSearchResult{{
		Market:            &catalogv1.NearbyMarket{Market: migrosJet(), DistanceMeters: 405},
		MarketNameMatched: true,
	}}})

	list, err := service.Search(context.Background(), SearchQuery{Lat: 40.9885, Lng: 29.0262, Query: "migros"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}

	want := `{"items":[{"market":` + migrosJetJSON + `,"distanceMeters":405,"marketNameMatched":true,"products":[],"totalProductMatches":0}]}`
	if encoded := testkit.JSON(t, list); encoded != want {
		t.Errorf("JSON:\n got %s\nwant %s", encoded, want)
	}
}

func TestSearchEmptyIsArrayNotNull(t *testing.T) {
	// Eslesme yok ya da bolgede market yok (Yazlik): hata DEGIL, bos liste.
	service := startStub(t, &searchStub{})

	list, err := service.Search(context.Background(), SearchQuery{Lat: 41.1363, Lng: 29.8539, Query: "süt"})
	if err != nil {
		t.Fatalf("hata beklenmiyordu: %v", err)
	}
	if encoded := testkit.JSON(t, list); encoded != `{"items":[]}` {
		t.Errorf("bos liste [] olmali, %s geldi", encoded)
	}
}

func TestSearchRenamesProtoFieldsInErrors(t *testing.T) {
	// Istemci ?q=s&lat=95 gonderdi; hata "query" ve "location.lat" degil, "q" ve "lat" demeli.
	service := startStub(t, &searchStub{
		err: status.Error(codes.InvalidArgument, "gecersiz"),
		trailer: metadata.Pairs(apperror.MetadataKey,
			`{"code":"VALIDATION_FAILED","message":"x","details":{"query":"en az 2 karakter olmali","location.lat":"enlem -90 ile 90 arasinda olmali"}}`),
	})

	_, err := service.Search(context.Background(), SearchQuery{Lat: 95, Lng: 29, Query: "s"})

	appErr := testkit.AppErrorOf(t, err)
	if appErr.Code != apperror.CodeValidationFailed {
		t.Fatalf("VALIDATION_FAILED bekleniyordu: %+v", appErr)
	}
	if appErr.Details["q"] != "en az 2 karakter olmali" || appErr.Details["lat"] != "enlem -90 ile 90 arasinda olmali" {
		t.Errorf("alan adlari REST'teki gibi olmali: %v", appErr.Details)
	}
}
