import { geoSearchQuerySchema } from '@getir/contracts';
import type { AddressSetupContent, GeoPlace } from '@getir/contracts';
import { useId, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

import { usePlaceSearch } from '../hooks/usePlaceSearch';

import styles from './AddressSearch.module.css';
import { SearchIcon } from './icons';

interface AddressSearchProps {
  readonly content: AddressSetupContent;
  /** Secilen sonuc: harita oraya gider. */
  readonly onPick: (place: GeoPlace) => void;
}

/**
 * Adres aramasi (T11.8; referans: "Sokagini veya posta kodunu arat"; gorunen
 * ipucu yer tutucudur, erisilebilir ad icerikteki etiket). Yazarken
 * degil GONDERINCE sorulur (Enter ya da buyutec): Nominatim saniyede bir soru
 * kabul eder. Sonuclar kutunun altinda haritanin ustunde acilir; secilen
 * sonuc haritayi oraya goturur ve liste kapanir.
 *
 * Esc acik listeyi (ya da yazilan metni) temizler; pencereyi KAPATMAZ: 1.
 * adimda kapatmak cikis demektir, arama kutusunda kaza ile olmamali.
 */
export function AddressSearch({ content, onPick }: AddressSearchProps) {
  const problemId = useId();
  const [text, setText] = useState('');
  const [query, setQuery] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const search = usePlaceSearch(query);
  const open = query !== undefined;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const parsed = geoSearchQuerySchema.safeParse({ q: text });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? null);
      setQuery(undefined);
      return;
    }
    setProblem(null);
    setQuery(parsed.data.q);
  };

  const pick = (place: GeoPlace): void => {
    setText(place.line);
    setQuery(undefined);
    onPick(place);
  };

  const dismiss = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Escape' || (!open && text === '')) {
      return;
    }
    // Tarayicinin "pencereyi kapat" istegi burada durur.
    event.preventDefault();
    if (open) {
      setQuery(undefined);
    } else {
      setText('');
    }
  };

  return (
    <div className={styles['c-address-search']}>
      <form role="search" className={styles['c-address-search__form']} onSubmit={submit} noValidate>
        <button
          type="submit"
          className={styles['c-address-search__submit']}
          aria-label={content.searchSubmitLabel}
          disabled={open && search.isFetching}
        >
          <SearchIcon />
        </button>
        <input
          type="search"
          aria-label={content.searchLabel}
          className={styles['c-address-search__input']}
          placeholder={content.searchPlaceholder}
          autoComplete="off"
          enterKeyHint="search"
          value={text}
          aria-invalid={problem !== null}
          aria-describedby={problem === null ? undefined : problemId}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={dismiss}
        />
      </form>
      {problem !== null && (
        <p id={problemId} className={styles['c-address-search__problem']}>
          {problem}
        </p>
      )}
      {open && (
        <div className={styles['c-address-search__results']} aria-busy={search.isFetching}>
          {search.error !== null && (
            <p className={styles['c-address-search__message']} role="alert">
              {search.error.message}
            </p>
          )}
          {search.data?.length === 0 && (
            <p className={styles['c-address-search__message']} role="status">
              {content.searchEmptyNotice}
            </p>
          )}
          {search.data !== undefined && search.data.length > 0 && (
            <ul className={styles['c-address-search__list']}>
              {search.data.map((place) => (
                <li key={place.line}>
                  <button
                    type="button"
                    className={styles['c-address-search__option']}
                    onClick={() => pick(place)}
                  >
                    {place.line}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
