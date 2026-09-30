import { SEARCH_QUERY_MAX_LENGTH } from '@getir/contracts';
import { useEffect, useRef, useState } from 'react';

import { createDebouncer } from '../../../shared/services/debounce';
import { SEARCH_DEBOUNCE_MS } from '../constants';
import { searchQueryFrom } from '../services/search-query';

import { ClearIcon, SearchIcon } from './icons';
import styles from './MarketSearchBox.module.css';

interface MarketSearchBoxProps {
  /** Adresteki (URL) gecerli arama; yoksa undefined. */
  readonly query: string | undefined;
  /** Yeni arama ya da aramanin kalkmasi; sayfa adrese yazar. */
  readonly onSearch: (query: string | undefined) => void;
}

/**
 * Market ici urun aramasi (T9.5) - TASARIMSIZ KABUK. Kutu yazilani hemen
 * gosterir; arama ancak yazim SEARCH_DEBOUNCE_MS durunca yayilir: hizli yazimda
 * tek istek gider, yeni arama gelince eskisini TanStack Query iptal eder. Hangi
 * metnin arama oldugu searchQueryFrom'dadir.
 *
 * Arama disaridan da degisebilir (kategori secimi aramayi kaldirir, geri
 * tusu): kutu adresi izler, ama kendi yaydigi aramaya donen adres yazilani
 * EZMEZ (kullanici o arada yazmaya devam etmis olabilir).
 */
export function MarketSearchBox({ query, onSearch }: MarketSearchBoxProps) {
  const [text, setText] = useState(query ?? '');
  const [debouncer] = useState(() => createDebouncer(SEARCH_DEBOUNCE_MS));
  const emitted = useRef(query);
  const onSearchRef = useRef(onSearch);

  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  useEffect(() => () => debouncer.cancel(), [debouncer]);

  useEffect(() => {
    if (query !== emitted.current) {
      debouncer.cancel();
      emitted.current = query;
      setText(query ?? '');
    }
  }, [query, debouncer]);

  const emit = (next: string | undefined): void => {
    if (next !== emitted.current) {
      emitted.current = next;
      onSearchRef.current(next);
    }
  };

  const change = (value: string): void => {
    setText(value);
    debouncer.schedule(() => emit(searchQueryFrom(value)));
  };

  const clear = (): void => {
    debouncer.cancel();
    setText('');
    emit(undefined);
  };

  return (
    <div className={styles['c-search-box']} role="search">
      <span className={styles['c-search-box__icon']}>
        <SearchIcon />
      </span>
      <input
        type="search"
        className={styles['c-search-box__input']}
        aria-label="Ürün ara"
        placeholder="Ürün ara…"
        enterKeyHint="search"
        autoComplete="off"
        maxLength={SEARCH_QUERY_MAX_LENGTH}
        value={text}
        onChange={(event) => change(event.target.value)}
      />
      {text !== '' && (
        <button
          type="button"
          className={styles['c-search-box__clear']}
          aria-label="Aramayı temizle"
          onClick={clear}
        >
          <ClearIcon />
        </button>
      )}
    </div>
  );
}
