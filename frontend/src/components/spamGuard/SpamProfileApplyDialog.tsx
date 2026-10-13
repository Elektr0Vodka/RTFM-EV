import { useT } from '../../i18n';
import type { FilterProfile, FilterProfileChange } from '../../types';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

export interface PendingProfileApply {
  profile: FilterProfile;
  changes: FilterProfileChange[];
}

/**
 * Asked before a profile is applied: every value that will change, old and
 * new, and a warning when the profile switches Spam Guard to Protect. A
 * profile can come from someone else, so the user reads it first.
 */
export function SpamProfileApplyDialog({
  pending,
  busy,
  onConfirm,
  onClose,
}: {
  pending: PendingProfileApply | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const changes = pending?.changes ?? [];
  const toProtect = changes.some((change) => change.key === 'mode' && change.to === 'protect');

  const label = (key: string) => {
    if (key === 'mode') return t('spam_mode_label');
    if (key === 'sensitivity') return t('spam_sensitivity_label');
    return t(`spam_set_${key}_label`);
  };

  const show = (key: string, value: unknown): string => {
    if (key === 'mode') return t(`spam_mode_${String(value)}`);
    if (key === 'sensitivity') return t(`spam_sensitivity_${String(value)}`);
    if (typeof value === 'boolean') {
      return t(value ? 'spam_profile_value_on' : 'spam_profile_value_off');
    }
    if (Array.isArray(value)) {
      // Name patterns are regular expressions: one per line, as written.
      return value.length > 0 ? value.map(String).join('\n') : t('spam_profile_value_none');
    }
    if (typeof value === 'string') return t(`spam_choice_${key}_${value}`);
    return String(value);
  };

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('spam_profile_apply_title', { name: pending?.profile.name ?? '' })}
          </DialogTitle>
          <DialogDescription>{t('spam_profile_apply_desc')}</DialogDescription>
        </DialogHeader>
        {toProtect && (
          <p className="rounded-md border border-warning/60 p-2 text-sm text-warning" role="alert">
            {t('spam_profile_apply_protect_warning')}
          </p>
        )}
        {changes.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">{t('spam_profile_apply_none')}</p>
        ) : (
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
            {changes.map((change) => (
              <li key={change.key} data-testid={`profile-change-${change.key}`}>
                <div className="text-sm font-medium">{label(change.key)}</div>
                <div className="whitespace-pre-wrap break-all font-mono text-[0.8125rem] text-muted-foreground">
                  {t('spam_profile_change_values', {
                    from: show(change.key, change.from),
                    to: show(change.key, change.to),
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
            {t('spam_profile_apply_cancel')}
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={onConfirm}>
            {t('spam_profile_apply_confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
