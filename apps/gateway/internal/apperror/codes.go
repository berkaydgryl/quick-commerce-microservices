// Package apperror, gateway'in hata modelidir: hata kodu, HTTP karsiligi,
// kullanici mesaji ve bagimli servislerden gelen gRPC hatalarinin cevirisi.
//
// Kod -> HTTP ve kod -> mesaj tablosu ELLE YAZILMAZ; @getir/core ve
// @getir/contracts'tan uretilir (codes_gen.go). Bu dosya yalnizca tabloyu okur.
package apperror

import "net/http"

// Code, hata sozlugundeki bir anahtar ("STOCK_INSUFFICIENT").
type Code string

type codeEntry struct {
	code       Code
	httpStatus int
	message    string
}

// codeIndex, uretilen tablonun koda gore dizini. Paket yuklenirken bir kez kurulur.
var codeIndex = func() map[Code]codeEntry {
	index := make(map[Code]codeEntry, len(codeTable))
	for _, entry := range codeTable {
		index[entry.code] = entry
	}
	return index
}()

// Known, kod sozlukte var mi? Bagimli servisten gelen metin koda cevrilmeden
// once buradan gecer: bilinmeyen bir kod istemciye sizmamali.
func Known(code Code) bool {
	_, ok := codeIndex[code]
	return ok
}

// HTTPStatus, kodun tablodaki HTTP karsiligi. Bilinmeyen kod 500'dur.
func HTTPStatus(code Code) int {
	if entry, ok := codeIndex[code]; ok {
		return entry.httpStatus
	}
	return http.StatusInternalServerError
}

// Message, kodun kullaniciya gosterilecek Turkce mesaji.
//
// NEDEN SERVISIN MESAJI DEGIL: @getir/contracts kurali - ayni kod iki ayri uctan
// iki farkli metinle donmemeli. Servisin mesaji gelistiriciye yoneliktir ve
// gunluge yazilir.
func Message(code Code) string {
	if entry, ok := codeIndex[code]; ok {
		return entry.message
	}
	return codeIndex[CodeInternal].message
}
