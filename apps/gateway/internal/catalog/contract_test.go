package catalog

import (
	"slices"
	"testing"

	catalogv1 "github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/catalog/v1"

	"github.com/berkaydgryl/quick-commerce-microservices/apps/gateway/internal/testkit"
)

// Dukkan turunun uc kopyasi vardir (T11.11): proto StoreType, bu paketin
// storeTypeNames eslemesi ve @getir/contracts storeTypeSchema. Biri degisip
// digeri unutulursa web market listesinde tur alani dusmus ya da sozlesmenin
// reddettigi bir deger gormus olurdu.

const contractCatalogPath = "../../../../packages/contracts/src/catalog.ts"

func TestStoreTypesMatchProtoAndContract(t *testing.T) {
	source := testkit.ReadContract(t, contractCatalogPath)
	contract := testkit.StringEnum(t, source, "storeTypeSchema")

	// Proto sirasiyla (UNSPECIFIED disinda her deger) gateway eslemesi.
	var gateway []string
	for number := int32(1); number < int32(len(catalogv1.StoreType_name)); number++ {
		name, ok := storeTypeNames[catalogv1.StoreType(number)]
		if !ok {
			t.Fatalf("proto turu %s gateway eslemesinde yok", catalogv1.StoreType_name[number])
		}
		gateway = append(gateway, name)
	}
	if len(storeTypeNames) != len(catalogv1.StoreType_name)-1 {
		t.Errorf("eslemede proto'da olmayan tur var: %v", storeTypeNames)
	}
	if !slices.Equal(gateway, contract) {
		t.Errorf("tur listesi farkli:\n gateway  %v\n sozlesme %v", gateway, contract)
	}
}
