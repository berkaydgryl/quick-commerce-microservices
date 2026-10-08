package content

// CourierTracking, kurye takibinin metinleri (F22; T13.3 asama 1): "Kuryem
// nerede" penceresi (baslik, kurye, harita, tahmini varis, kalan mesafe,
// teslimat adresi, asama cumleleri, ekran disi kurye gostergesi) ve yaklasma
// bildirimi. Yalnizca metin; konum, sure ve mesafe takip ucundan
// (GET /v1/orders/{id}/tracking).
type CourierTracking struct {
	Title               string `json:"title"`
	CloseLabel          string `json:"closeLabel"`
	CourierLabel        string `json:"courierLabel"`
	MapLabel            string `json:"mapLabel"`
	EtaLabel            string `json:"etaLabel"`
	EtaPrefix           string `json:"etaPrefix"`
	MinuteSuffix        string `json:"minuteSuffix"`
	DistanceLabel       string `json:"distanceLabel"`
	KilometerSuffix     string `json:"kilometerSuffix"`
	MeterSuffix         string `json:"meterSuffix"`
	AddressLabel        string `json:"addressLabel"`
	LoadingLabel        string `json:"loadingLabel"`
	PickupNotice        string `json:"pickupNotice"`
	DeliveredNotice     string `json:"deliveredNotice"`
	UnavailableNotice   string `json:"unavailableNotice"`
	RetryLabel          string `json:"retryLabel"`
	ApproachTitle       string `json:"approachTitle"`
	ApproachActionLabel string `json:"approachActionLabel"`
	ApproachCloseLabel  string `json:"approachCloseLabel"`
	// OffscreenCourierLabel, harita kaydirilinca kenardaki kurye gostergesinin adi.
	OffscreenCourierLabel string `json:"offscreenCourierLabel"`
}
