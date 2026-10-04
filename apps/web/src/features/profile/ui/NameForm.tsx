import { updateProfileRequestSchema } from '@getir/contracts';
import type { EditProfileDialogContent, UpdateProfileRequest } from '@getir/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { formFeedback } from '../../auth/services/server-errors';
import { AuthField } from '../../auth/ui/AuthField';
import { showServerErrors } from '../../auth/ui/form-errors';
import { useUpdateProfile } from '../hooks/useUpdateProfile';

import styles from './ProfileDialog.module.css';

const NAME_FIELDS = ['fullName'] as const;

interface NameFormProps {
  readonly userId: string;
  readonly texts: EditProfileDialogContent;
  readonly fullName: string;
  /** Kayit basarili: ust bilesen bildirim gosterir. */
  readonly onSaved: () => void;
}

/**
 * Ad (T11.14 PR 3, #89): pencerede yerinde duzenlenir, "Kaydet". Kural
 * kayittakiyle ayni (2-80 karakter, kirpilir); sunucunun cumlesi alanin altinda.
 */
export function NameForm({ userId, texts, fullName, onSaved }: NameFormProps) {
  const update = useUpdateProfile(userId);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof updateProfileRequestSchema>, unknown, UpdateProfileRequest>({
    resolver: zodResolver(updateProfileRequestSchema),
    defaultValues: { fullName },
  });

  const submit = async (request: UpdateProfileRequest): Promise<void> => {
    setFormMessage(null);
    try {
      await update.mutateAsync(request);
      onSaved();
    } catch (error) {
      const feedback = formFeedback(error, NAME_FIELDS);
      showServerErrors(NAME_FIELDS, feedback.fields, setError);
      setFormMessage(feedback.message);
    }
  };

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(submit)(event)}>
      {formMessage !== null && (
        <p className={styles['c-profile-dialog__alert']} role="alert">
          {formMessage}
        </p>
      )}
      <div className={styles['c-profile-dialog__name']}>
        <AuthField
          id="profil-ad"
          label={texts.nameLabel}
          autoComplete="name"
          error={errors.fullName?.message}
          {...register('fullName')}
        />
        <button type="submit" className={styles['c-profile-dialog__save']} disabled={isSubmitting}>
          {isSubmitting ? texts.savingNameLabel : texts.saveNameLabel}
        </button>
      </div>
    </form>
  );
}
