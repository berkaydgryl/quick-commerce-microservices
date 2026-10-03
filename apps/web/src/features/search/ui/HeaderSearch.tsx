import { SEARCH_QUERY_MAX_LENGTH } from '@getir/contracts';
import type { AppHeaderContent } from '@getir/contracts';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { createDebouncer } from '../../../shared/services/debounce';
import { SEARCH_DEBOUNCE_MS } from '../../catalog/constants';
import { searchQueryFrom } from '../../catalog/services/search-query';
import { SEARCH_PARAM, SEARCH_PATH, searchHref } from '../services/search-route';

import styles from './HeaderSearch.module.css';
import { ClearIcon, SearchIcon } from './icons';

interface HeaderSearchProps {
  readonly content: AppHeaderContent;
  /** Kutunun sag ucundaki teslimat adresi (uygulama verir: adres ozelligi). */
  readonly address: ReactNode;
}

/**
 * Ust bardaki genel arama (T11.10; referans getircarsi "Carsida ara... 🏠 Ev ›"):
 * beyaz kutu, solda buyutec, sag ucunda teslimat adresi.
 *
 *  - Ana sayfada yazdikca arar: yazim SEARCH_DEBOUNCE_MS durunca `?ara=`
 *    guncellenir, sonuclar sayfada gorunur (T9.6 davranisi).
 *  - Baska sayfada (market, hesabim) yazarken sayfa degismez; Enter aramayi
 *    ana sayfaya, sonuclara tasir. Yazarken gecis olsaydi kutu yeniden kurulur
 *    ve klavye odagi kaybolurdu.
 *
 * Adresteki arama disaridan da degisebilir (geri tusu, temizleme): kutu adresi
 * izler ama kendi yaydigi aramaya donen adres yazilani EZMEZ.
 */
export function HeaderSearch({ content, address }: HeaderSearchProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const onResults = location.pathname === SEARCH_PATH;
  const query = onResults ? searchQueryFrom(searchParams.get(SEARCH_PARAM) ?? '') : undefined;
  const [text, setText] = useState(query ?? '');
  const [debouncer] = useState(() => createDebouncer(SEARCH_DEBOUNCE_MS));
  const emitted = useRef(query);

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
      setSearchParams(next === undefined ? {} : { [SEARCH_PARAM]: next }, { replace: true });
    }
  };

  const change = (value: string): void => {
    setText(value);
    if (onResults) {
      debouncer.schedule(() => emit(searchQueryFrom(value)));
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const next = searchQueryFrom(text);
    if (onResults) {
      debouncer.cancel();
      emit(next);
    } else if (next !== undefined) {
      navigate(searchHref(next));
    }
  };

  const clear = (): void => {
    debouncer.cancel();
    setText('');
    if (onResults) {
      emit(undefined);
    }
  };

  return (
    <div className={styles['c-header-search']}>
      <form role="search" className={styles['c-header-search__form']} onSubmit={submit}>
        <span className={styles['c-header-search__icon']}>
          <SearchIcon />
        </span>
        <input
          type="search"
          className={styles['c-header-search__input']}
          aria-label={content.searchLabel}
          placeholder={content.searchPlaceholder}
          enterKeyHint="search"
          autoComplete="off"
          maxLength={SEARCH_QUERY_MAX_LENGTH}
          value={text}
          onChange={(event) => change(event.target.value)}
        />
        {text !== '' && (
          <button
            type="button"
            className={styles['c-header-search__clear']}
            aria-label={content.searchClearLabel}
            onClick={clear}
          >
            <ClearIcon />
          </button>
        )}
      </form>
      <div className={styles['c-header-search__address']}>{address}</div>
    </div>
  );
}

/** Icerik gelene kadar ayni boyda bos kutu: bar ziplamaz. */
export function HeaderSearchPlaceholder() {
  return <div className={styles['c-header-search']} aria-busy="true" />;
}
