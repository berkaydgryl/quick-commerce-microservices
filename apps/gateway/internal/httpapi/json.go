package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// encodeJSON, Fiber'in JSON kodlayicisi.
//
// NEDEN VARSAYILAN DEGIL: encoding/json &, < ve > karakterlerini HTML icine
// gomulme ihtimaline karsi & bicimine cevirir ("Süt & Kahvaltılık" ->
// "Süt & Kahvaltılık"). Cevap her zaman application/json'dur, HTML'e
// gomulmez; kacis yalnizca okunakliligi bozar ve cevap boyutunu buyutur.
func encodeJSON(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, fmt.Errorf("json kodlanamadi: %w", err)
	}
	// Encoder sona satir sonu ekler; Marshal eklemez. Govde Marshal ile ayni kalsin.
	return bytes.TrimSuffix(buffer.Bytes(), []byte("\n")), nil
}
