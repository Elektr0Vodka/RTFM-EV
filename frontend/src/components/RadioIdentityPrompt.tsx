import { useEffect, useMemo, useState } from 'react';
import { RadioTower } from 'lucide-react';

import { api } from '../api';
import { useT } from '../i18n';
import type { HealthStatus, RadioIdentity, RadioIdentityHealth } from '../types';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { toast } from './ui/sonner';
import { radioKey } from '../gateway/context';

/** sessionStorage key: ids of pending radios whose prompt this browser session dismissed. */
const DISMISSED_KEY = 'meshcore_radio_identity_prompt_dismissed';

function readDismissed(): number[] {
  try {
    const raw = window.sessionStorage.getItem(radioKey(DISMISSED_KEY));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: number[]): void {
  try {
    window.sessionStorage.setItem(radioKey(DISMISSED_KEY), JSON.stringify(ids));
  } catch {
    // Best effort: without storage the prompt simply shows again after a reload.
  }
}

/** "Name (aabbccddeeff)" for a radio; the key prefix tells same-named radios apart. */
export function useRadioLabel() {
  const t = useT();
  return (radio: Pick<RadioIdentity, 'name' | 'public_key'>) =>
    t('radio_identity_label', {
      name: radio.name || t('radio_identity_unnamed'),
      key: radio.public_key.slice(0, 12),
    });
}

type Pending = Pick<RadioIdentityHealth, 'id' | 'name' | 'public_key' | 'pending_reason'>;

interface RadioIdentityResolverProps {
  identity: Pending;
  /** Every registered radio; the replacement picker offers those not already replaced. */
  radios: RadioIdentity[];
  onResolved: () => void;
  /** Shown as "Decide later" when given. */
  onLater?: () => void;
}

/**
 * Plan 18: the answer form for a pending radio. ``new_key``: new radio, or a
 * replacement for an earlier one with a carry-over checklist. ``legacy_history``:
 * whether samples recorded before radio tracking belong to this radio.
 * Nothing here talks to the radio or transmits.
 */
export function RadioIdentityResolver({
  identity,
  radios,
  onResolved,
  onLater,
}: RadioIdentityResolverProps) {
  const t = useT();
  const radioLabel = useRadioLabel();
  const candidates = useMemo(
    () => radios.filter((r) => r.id !== identity.id && r.replaced_by === null),
    [radios, identity.id]
  );
  const [mode, setMode] = useState<'new' | 'replace'>('new');
  const [oldId, setOldId] = useState<number | null>(null);
  const [carryStats, setCarryStats] = useState(true);
  const [carryOwned, setCarryOwned] = useState(true);
  const [carryNote, setCarryNote] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (oldId === null || !candidates.some((r) => r.id === oldId)) {
      setOldId(candidates[0]?.id ?? null);
    }
  }, [candidates, oldId]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      toast.success(t('radio_identity_saved'));
      onResolved();
    } catch (err) {
      toast.error(t('radio_identity_save_failed'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  if (identity.pending_reason === 'legacy_history') {
    return (
      <div className="space-y-3">
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('radio_identity_legacy_question', { radio: radioLabel(identity) })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy}
            onClick={() => run(() => api.answerLegacyHistory(identity.id, true))}
          >
            {t('radio_identity_legacy_yes')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => run(() => api.answerLegacyHistory(identity.id, false))}
          >
            {t('radio_identity_legacy_no')}
          </Button>
          {onLater && (
            <Button type="button" variant="ghost" disabled={busy} onClick={onLater}>
              {t('radio_identity_later')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const canReplace = candidates.length > 0;
  const submit = () =>
    mode === 'replace' && oldId !== null
      ? run(() =>
          api.replaceRadio(identity.id, {
            old_id: oldId,
            carry_stats: carryStats,
            carry_owned: carryOwned,
            carry_note: carryNote,
          })
        )
      : run(() => api.confirmNewRadio(identity.id));

  return (
    <div className="space-y-3">
      <p className="text-[0.8125rem] text-muted-foreground">
        {t('radio_identity_new_key_question', { radio: radioLabel(identity) })}
      </p>
      <fieldset className="space-y-2" disabled={busy}>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`radio-identity-mode-${identity.id}`}
            checked={mode === 'new'}
            onChange={() => setMode('new')}
          />
          {t('radio_identity_choice_new')}
        </label>
        {canReplace && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`radio-identity-mode-${identity.id}`}
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
            />
            {t('radio_identity_choice_replace')}
          </label>
        )}
      </fieldset>

      {mode === 'replace' && canReplace && (
        <div className="space-y-3 rounded-md border border-input bg-muted/20 p-3">
          <div className="space-y-1.5">
            <Label htmlFor={`radio-identity-old-${identity.id}`}>
              {t('radio_identity_replaces_label')}
            </Label>
            <select
              id={`radio-identity-old-${identity.id}`}
              value={oldId ?? ''}
              disabled={busy}
              onChange={(e) => setOldId(Number(e.target.value))}
              className="block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {candidates.map((r) => (
                <option key={r.id} value={r.id}>
                  {radioLabel(r)}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">
            {t('radio_identity_carry_heading')}
          </p>
          <CarryCheckbox
            id={`radio-identity-carry-stats-${identity.id}`}
            checked={carryStats}
            onChange={setCarryStats}
            label={t('radio_identity_carry_stats')}
            disabled={busy}
          />
          <CarryCheckbox
            id={`radio-identity-carry-owned-${identity.id}`}
            checked={carryOwned}
            onChange={setCarryOwned}
            label={t('radio_identity_carry_owned')}
            disabled={busy}
          />
          <CarryCheckbox
            id={`radio-identity-carry-note-${identity.id}`}
            checked={carryNote}
            onChange={setCarryNote}
            label={t('radio_identity_carry_note')}
            disabled={busy}
          />
          <p className="text-[0.8125rem] text-muted-foreground">{t('radio_identity_carry_help')}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy || (mode === 'replace' && oldId === null)}
          onClick={submit}
        >
          {t('radio_identity_confirm')}
        </Button>
        {onLater && (
          <Button type="button" variant="ghost" disabled={busy} onClick={onLater}>
            {t('radio_identity_later')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function CarryCheckbox({
  id,
  checked,
  onChange,
  label,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
    </div>
  );
}

interface RadioIdentityPromptProps {
  health: HealthStatus | null;
}

/**
 * Plan 18 connect-time question, shown while the active radio is pending.
 * State comes from the health payload, so a tab opened later still sees it;
 * once any tab answers, the next health update closes it everywhere.
 * "Decide later" hides it for this browser session; Settings > Radio > Radios
 * resolves it any time. It never blocks using the radio.
 */
export function RadioIdentityPrompt({ health }: RadioIdentityPromptProps) {
  const t = useT();
  const identity = health?.radio_identity ?? null;
  const [dismissed, setDismissed] = useState<number[]>(readDismissed);
  const [resolvedId, setResolvedId] = useState<number | null>(null);
  const [radios, setRadios] = useState<RadioIdentity[] | null>(null);

  const open =
    identity !== null &&
    identity.status === 'pending' &&
    identity.id !== resolvedId &&
    !dismissed.includes(identity.id);
  const identityId = identity?.id ?? null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .getRadioIdentities()
      .then((list) => {
        if (!cancelled) setRadios(list.radios);
      })
      .catch(() => {
        if (!cancelled) setRadios([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, identityId]);

  if (!open || identity === null) return null;

  const later = () => {
    const next = [...dismissed, identity.id];
    writeDismissed(next);
    setDismissed(next);
  };

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && later()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <RadioTower className="h-5 w-5 text-primary" aria-hidden="true" />
            <DialogTitle>
              {identity.pending_reason === 'legacy_history'
                ? t('radio_identity_legacy_title')
                : t('radio_identity_new_key_title')}
            </DialogTitle>
          </div>
          <DialogDescription>{t('radio_identity_prompt_desc')}</DialogDescription>
        </DialogHeader>
        {radios === null ? (
          <p className="text-sm text-muted-foreground">{t('radio_identity_loading')}</p>
        ) : (
          <RadioIdentityResolver
            identity={identity}
            radios={radios}
            onResolved={() => setResolvedId(identity.id)}
            onLater={later}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
