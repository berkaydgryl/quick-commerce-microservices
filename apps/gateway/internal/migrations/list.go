package migrations

// All, gateway'in gocleri, surum sirasinda. Yeni goc sona eklenir; uygulanmis
// goc listeden cikarilmaz ve degistirilmez (duzeltme yeni goctur).
func All() []Migration {
	return []Migration{
		addressIDs(),
	}
}
