import type {
  FieldErrors,
  FieldValues,
  Path,
  UseFormSetError,
  UseFormSetFocus,
} from 'react-hook-form';

/**
 * Kimlik formlarinin hata ve odak kurali (T8.5): odak EKRANDAKI SIRAYLA ilk
 * hatali alana gider. react-hook-form alanlari kayit sirasiyla gezer; telefon
 * alani (Controller) sifreden sonra kaydoldugu icin kendi odagi sifreye
 * gidiyordu (canli testte bulundu). Formlar bu yuzden shouldFocusError: false
 * kullanir ve sirayi `fields` verir.
 */

/** Istemci dogrulamasi gecmedi: sirayla ilk hatali alana odaklan. */
export function focusFirstInvalid<V extends FieldValues>(
  fields: readonly Path<V>[],
  errors: FieldErrors<V>,
  setFocus: UseFormSetFocus<V>,
): void {
  const first = fields.find((field) => field in errors);
  if (first !== undefined) {
    setFocus(first);
  }
}

/** Sunucunun alan mesajlari alanlarin altina; odak sirayla ilk hatali alana. */
export function showServerErrors<V extends FieldValues>(
  fields: readonly Path<V>[],
  messages: Partial<Record<Path<V>, string>>,
  setError: UseFormSetError<V>,
): void {
  let focus = true;
  for (const field of fields) {
    const message = messages[field];
    if (message !== undefined) {
      setError(field, { type: 'server', message }, { shouldFocus: focus });
      focus = false;
    }
  }
}
