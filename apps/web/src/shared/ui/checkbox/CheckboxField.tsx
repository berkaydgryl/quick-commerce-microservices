import styles from './CheckboxField.module.css';

interface CheckboxFieldProps {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

/** Onay kutusu ve etiketi (T17.1; "Zili Çalma"): etiket tiklamayi kutuya tasir. */
export function CheckboxField({ id, label, checked, onChange }: CheckboxFieldProps) {
  return (
    <label className={styles['c-checkbox']} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className={styles['c-checkbox__box']}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
