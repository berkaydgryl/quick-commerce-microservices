package testkit

import (
	"os"
	"regexp"
	"strconv"
	"testing"
)

// Sozlesme kurallarinin iki kopyasi vardir: @getir/contracts (web ve Node) ve
// gateway. Go TypeScript okuyamaz; sozlesme testleri kaynagi METIN olarak
// okuyup iki tarafi karsilastirir. Biri degisip digeri unutulursa kirmizi olur
// (error-codes.ts icin codes:go:check'in yaptigi is).

// ContractConstantsPath, sozlesme sabitlerinin internal/<paket> klasorunden
// goreli yolu (go test paketin klasorunde calisir).
const ContractConstantsPath = "../../../../packages/contracts/src/constants.ts"

// ReadContract, sozlesme kaynagini okur; okunamazsa test durur.
func ReadContract(t *testing.T, path string) string {
	t.Helper()
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("sozlesme kaynagi okunamadi (%s): %v", path, err)
	}
	return string(source)
}

// NumberConstant, `export const AD = 8;` satirindaki sayi.
func NumberConstant(t *testing.T, source, name string) int {
	t.Helper()
	match := regexp.MustCompile(`export const ` + name + ` = (\d+);`).FindStringSubmatch(source)
	if match == nil {
		t.Fatalf("%s sozlesmede bulunamadi", name)
	}
	value, err := strconv.Atoi(match[1])
	if err != nil {
		t.Fatalf("%s sayi degil: %v", name, err)
	}
	return value
}

// PatternConstant, `export const AD = /desen/;` satirindaki desen.
func PatternConstant(t *testing.T, source, name string) string {
	t.Helper()
	match := regexp.MustCompile(`export const ` + name + ` = /(.+)/;`).FindStringSubmatch(source)
	if match == nil {
		t.Fatalf("%s sozlesmede bulunamadi", name)
	}
	return match[1]
}

// StringEnum, `export const AD = z.enum(['A', 'B']);` satirindaki degerler,
// sozlesmedeki sirayla (dizi birden cok satira bolunebilir).
func StringEnum(t *testing.T, source, name string) []string {
	t.Helper()
	match := regexp.MustCompile(`export const ` + name + ` = z\.enum\(\[([^\]]*)\]\);`).FindStringSubmatch(source)
	if match == nil {
		t.Fatalf("%s sozlesmede bulunamadi", name)
	}
	values := regexp.MustCompile(`'([^']*)'`).FindAllStringSubmatch(match[1], -1)
	names := make([]string, 0, len(values))
	for _, value := range values {
		names = append(names, value[1])
	}
	return names
}
