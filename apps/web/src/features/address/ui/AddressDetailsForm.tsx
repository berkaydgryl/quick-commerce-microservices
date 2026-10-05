import type { AddressKind, AddressSetupContent, GeoPoint, SavedAddress } from '@getir/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

// Alan, sunucu hatasi ve odak kurallari kimlik formlariyla ORTAK (T8.5);
// adres formu ayni gorunumu ve ayni hata davranisini kullanir.
import { formFeedback } from '../../auth/services/server-errors';
import { AuthField } from '../../auth/ui/AuthField';
import { focusFirstInvalid, showServerErrors } from '../../auth/ui/form-errors';
import { useNearbyMarkets } from '../../markets/hooks/useNearbyMarkets';
import { useAddAddress } from '../hooks/useAddAddress';
import { useSavedAddresses } from '../hooks/useSavedAddresses';
import { useUpdateAddress } from '../hooks/useUpdateAddress';
import {
  ADDRESS_BOOK_FIELD,
  ADDRESS_FORM_FIELDS,
  addressFormSchema,
  editAddressValues,
  initialAddressValues,
  titleForKind,
  toCreateAddressRequest,
} from '../services/address-form';
import type { AddressFormOutput, AddressFormValues } from '../services/address-form';
import type { ResolvedLine } from '../services/line-notice';

import { AddressButton } from './AddressButton';
import styles from './AddressDetailsForm.module.css';
import { KindSelect } from './KindSelect';
import { LazyAddressMap } from './LazyAddressMap';

interface AddressDetailsFormProps {
  readonly content: AddressSetupContent;
  readonly userId: string;
  /** Haritada secilen nokta (1. adim). */
  readonly location: GeoPoint;
  /** Noktanin adres satiri; bulunamadiysa bos ve uyarili. */
  readonly resolved: ResolvedLine;
  /** Kayittan sonra (ust bardan eklemede pencereyi kapatir). */
  readonly onSaved?: (() => void) | undefined;
  /** Eklemede secili tur (T11.15, T4). */
  readonly initialKind?: AddressKind | undefined;
  /** Duzenleme modu (T11.15): kayitli adres, kayit PUT, altta "Adresi sil". */
  readonly editing?:
    | {
        readonly address: SavedAddress;
        readonly deleteLabel: string;
        readonly onDelete: () => void;
      }
    | undefined;
}

/**
 * Adres detayi (T11.8; 2. adim; referans: getir.com): secilen noktanin kucuk
 * haritasi, tur + baslik ("Ev"), adres satiri (haritadan dolu gelir), bina /
 * kat / daire, adres tarifi ve "Kaydet". Kaydedilince defter guncellenir ve
 * yeni adres secilir; ana sayfa kapisi (RootPage) market listesine gecer.
 *
 * Secilen yere hizmet veren market yoksa uyari gorunur ama kayit engellenmez.
 *
 * Duzenleme modunda (T11.15) alanlar kayitli adresle dolu gelir; nokta
 * degistiyse satir yeni noktanin satiridir (bulunamadiysa eski satir kalir).
 * Kayit PUT'tur ve adin tekilligi adresin KENDI adini saymaz.
 */
export function AddressDetailsForm({
  content,
  userId,
  location,
  resolved,
  onSaved,
  initialKind,
  editing,
}: AddressDetailsFormProps) {
  const adding = useAddAddress(userId);
  const updating = useUpdateAddress(userId);
  const markets = useNearbyMarkets(location);
  // Defterdeki adlar: onerilen baslik bunlardan biri olmasin ("Ev 2"). Duzenlenen
  // adresin kendi adi sayilmaz.
  const taken = (useSavedAddresses(userId).data ?? [])
    .filter((address) => address.id !== editing?.address.id)
    .map((address) => address.title);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    setError,
    setFocus,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<AddressFormValues, unknown, AddressFormOutput>({
    resolver: zodResolver(addressFormSchema),
    defaultValues:
      editing === undefined
        ? initialAddressValues(content.kinds, resolved.line, taken, initialKind)
        : editAddressValues(editing.address, resolved.line === '' ? undefined : resolved.line),
    // Odak sirasi form-errors.ts'te: react-hook-form kayit sirasiyla gezer.
    shouldFocusError: false,
  });

  // Satir haritadan geldiyse sira bina/kat/dairede; gelmediyse satiri yazmakta.
  useEffect(() => {
    setFocus(resolved.line === '' ? 'line' : 'building');
  }, [setFocus, resolved.line]);

  const submit = async (values: AddressFormOutput): Promise<void> => {
    setFormMessage(null);
    try {
      const request = toCreateAddressRequest(values, location);
      if (editing === undefined) {
        await adding.mutateAsync(request);
      } else {
        await updating.mutateAsync({ addressId: editing.address.id, request });
      }
      onSaved?.();
    } catch (error) {
      const feedback = formFeedback(error, [...ADDRESS_FORM_FIELDS, ADDRESS_BOOK_FIELD]);
      showServerErrors(ADDRESS_FORM_FIELDS, feedback.fields, setError);
      setFormMessage(feedback.fields[ADDRESS_BOOK_FIELD] ?? feedback.message);
    }
  };

  return (
    <form
      className={styles['c-address-form']}
      noValidate
      onSubmit={(event) =>
        void handleSubmit(submit, (invalid) =>
          focusFirstInvalid(ADDRESS_FORM_FIELDS, invalid, setFocus),
        )(event)
      }
    >
      <LazyAddressMap
        map={content.map}
        center={location}
        label={content.title}
        interactive={false}
      />
      {resolved.notice !== null && (
        <p className={styles['c-address-form__notice']} role="status">
          {resolved.notice}
        </p>
      )}
      {markets.data?.length === 0 && (
        <p className={styles['c-address-form__notice']} role="status">
          {content.noMarketNotice}
        </p>
      )}
      {formMessage !== null && (
        <p className={styles['c-address-form__alert']} role="alert">
          {formMessage}
        </p>
      )}
      <div className={styles['c-address-form__title-row']}>
        <Controller
          name="kind"
          control={control}
          render={({ field }) => (
            <KindSelect
              id="adres-tur"
              label={content.kindLabel}
              kinds={content.kinds}
              value={field.value}
              onChange={(kind) => {
                setValue('title', titleForKind(content.kinds, getValues('title'), kind, taken));
                field.onChange(kind);
              }}
            />
          )}
        />
        <AuthField
          id="adres-baslik"
          label={content.titleLabel}
          autoComplete="off"
          error={errors.title?.message}
          {...register('title')}
        />
      </div>
      <AuthField
        id="adres-satir"
        label={content.lineLabel}
        autoComplete="street-address"
        error={errors.line?.message}
        {...register('line')}
      />
      <div className={styles['c-address-form__unit-row']}>
        <AuthField
          id="adres-bina"
          label={content.buildingLabel}
          autoComplete="off"
          error={errors.building?.message}
          {...register('building')}
        />
        <AuthField
          id="adres-kat"
          label={content.floorLabel}
          autoComplete="off"
          error={errors.floor?.message}
          {...register('floor')}
        />
        <AuthField
          id="adres-daire"
          label={content.apartmentLabel}
          autoComplete="off"
          error={errors.apartment?.message}
          {...register('apartment')}
        />
      </div>
      <AuthField
        id="adres-tarif"
        label={content.noteLabel}
        autoComplete="off"
        error={errors.note?.message}
        {...register('note')}
      />
      <AddressButton type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
        {isSubmitting ? content.savingLabel : content.saveLabel}
      </AddressButton>
      {editing !== undefined && (
        <button
          type="button"
          className={styles['c-address-form__delete']}
          disabled={isSubmitting}
          onClick={editing.onDelete}
        >
          {editing.deleteLabel}
        </button>
      )}
    </form>
  );
}
