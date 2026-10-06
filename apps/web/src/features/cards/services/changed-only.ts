/**
 * Deger degismediyse cagirmaz (T11.17, QA K6 ve M7). Kart formunda ayni
 * deger (or. CVV'ye harf yazildi, rakamlar ayni) forma ve izleyiciye hic
 * gitmez; bu yuzden izleyici "degisti mi" diye onceki degeri saklamaz:
 * numara ve CVV'nin kopyasi form durumu disinda tutulmaz.
 */
export function onlyWhenChanged<T>(current: T, onChange: (value: T) => void): (value: T) => void {
  return (value) => {
    if (!Object.is(value, current)) {
      onChange(value);
    }
  };
}
