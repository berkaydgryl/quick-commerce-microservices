//go:build tools

// Bu dosya DERLENMEZ; "tools" etiketi hicbir normal derlemede acik degildir.
// Tek isi go.mod'daki surum satirlarini CANLI TUTMAKTIR.
//
// Sorun sudur: gen/go klasoru .gitignore icindedir, yani temiz bir klonda bu
// modulde TEK BIR .go dosyasi bulunmaz. O durumda "go mod tidy" hicbir paketin
// kullanilmadigini gorur ve butun require satirlarini siler; sonraki
// "pnpm proto:gen" sonrasi derleme bagimlilik bulunamadigi icin patlar.
// "go mod tidy" ise -ignore haric- tum yapi etiketlerini hesaba katar, bu yuzden
// asagidaki bos importlar surumleri sabitler.
//
// Ikinci faydasi: eklenti surumleri de buradan gelir. Gelistirici
//     go install google.golang.org/protobuf/cmd/protoc-gen-go
// dedinde surum bu go.mod'dan okunur; "@latest" yazmaya gerek kalmaz ve herkes
// ayni eklenti surumuyle uretir.
package tools

import (
	// Uretilen *.pb.go dosyalarinin calisma zamani bagimliligi.
	_ "google.golang.org/protobuf/proto"
	// Uretilen *_grpc.pb.go dosyalarinin calisma zamani bagimliligi.
	_ "google.golang.org/grpc"

	// Kod ureten eklentiler: surumleri sabitlensin diye.
	_ "google.golang.org/grpc/cmd/protoc-gen-go-grpc"
	_ "google.golang.org/protobuf/cmd/protoc-gen-go"
)
