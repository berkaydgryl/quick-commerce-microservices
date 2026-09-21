// @getir/proto - uretilen Go kodunun (gen/go) modulu.
//
// MODUL YOLU TESADUF DEGIL. Her .proto dosyasindaki go_package satiri
//     github.com/berkaydgryl/quick-commerce-microservices/packages/proto/gen/go/getir/<alan>/v1
// yazar. Bu modul packages/proto klasorunde durdugu ve buf.gen.go.yaml
// "paths=source_relative" ile urettigi icin, gen/go/getir/<alan>/v1 klasoru
// tam olarak o import yoluna denk duser. Ikisinden biri degisirse
// apps/gateway "package ... is not in std" hatasi verir.
//
// Asagidaki "go" satiri elle secilmedi: "go mod tidy" onu BAGIMLILIKLARIN
// dayattigi tabana cekti. google.golang.org/grpc v1.84 Go 1.25 istiyor, bu yuzden
// roadmap'teki "1.23+" artik yetmez; gercek taban 1.25'tir. Satiri elle geri
// dusurmeyin - tidy bir sonraki kosuda geri yukseltir ve CI'da Go surumu ile
// go.mod arasinda celiski cikar.
module github.com/berkaydgryl/quick-commerce-microservices/packages/proto

go 1.25.0

require (
	google.golang.org/grpc v1.84.0
	google.golang.org/grpc/cmd/protoc-gen-go-grpc v1.6.2
	google.golang.org/protobuf v1.36.12
)

require (
	golang.org/x/net v0.57.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/text v0.40.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20260706201446-f0a921348800 // indirect
)
