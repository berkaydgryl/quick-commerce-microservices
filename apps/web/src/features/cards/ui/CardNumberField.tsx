import type { FocusEventHandler, RefCallback } from 'react';
import { useCallback, useLayoutEffect, useRef } from 'react';

import { AuthField } from '../../auth/ui/AuthField';
import { caretAfterDigits, editCardNumber, formatCardNumber } from '../services/card-input';

interface CardNumberFieldProps {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  /** Yalnizca rakamlar; alanda gruplu gorunur. */
  readonly value: string;
  readonly onChange: (digits: string) => void;
  readonly onFocus: FocusEventHandler<HTMLInputElement>;
  readonly onBlur: FocusEventHandler<HTMLInputElement>;
  readonly fieldRef: RefCallback<HTMLInputElement>;
  readonly error: string | undefined;
}

/**
 * Kart numarasi alani (T11.17; QA C7): yazdikca 4'erli (Amex 4-6-5) gruplanir
 * ve imlec YERINDE kalir: ortada bir rakam degisince sona atlamaz; bosluktan
 * sonra Backspace soldaki rakami siler (services/card-input.ts editCardNumber).
 * Imlec, React yeni degeri yazar yazmaz, ekran cizilmeden konur
 * (useLayoutEffect; QA D4: bir kare sonda kalmaz). Rakamlar degismediyse
 * (harf yazildi) yeniden cizim olmaz: deger ve imlec hemen yerine konur.
 */
export function CardNumberField({
  id,
  name,
  label,
  value,
  onChange,
  onFocus,
  onBlur,
  fieldRef,
  error,
}: CardNumberFieldProps) {
  const input = useRef<HTMLInputElement | null>(null);
  /** Sonraki cizimde konacak imlec (rakam degisti). */
  const pendingCaret = useRef<number | null>(null);
  // Tek ref: imleci koymak icin alan ve react-hook-form'un odagi (her cizimde yeni ref olmasin).
  const ref = useCallback(
    (element: HTMLInputElement | null) => {
      input.current = element;
      fieldRef(element);
    },
    [fieldRef],
  );
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    if (caret !== null && input.current !== null && document.activeElement === input.current) {
      input.current.setSelectionRange(caret, caret);
    }
  });
  return (
    <AuthField
      ref={ref}
      id={id}
      name={name}
      label={label}
      floatingLabel
      inputMode="numeric"
      autoComplete="cc-number"
      value={formatCardNumber(value)}
      onChange={(event) => {
        const target = event.target;
        const inputType = (event.nativeEvent as { inputType?: string }).inputType;
        const edit = editCardNumber(
          value,
          target.value,
          target.selectionStart ?? target.value.length,
          inputType,
        );
        const formatted = formatCardNumber(edit.digits);
        const caret = caretAfterDigits(formatted, edit.caretDigits);
        if (edit.digits === value) {
          // Yeniden cizim olmayacak: React'in kontrollu deger geri yuklemesi imleci sona atmasin.
          target.value = formatted;
          target.setSelectionRange(caret, caret);
          return;
        }
        pendingCaret.current = caret;
        onChange(edit.digits);
      }}
      onFocus={onFocus}
      onBlur={onBlur}
      error={error}
    />
  );
}
