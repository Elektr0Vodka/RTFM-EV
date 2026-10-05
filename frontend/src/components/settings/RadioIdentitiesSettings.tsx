import { useCallback, useEffect, useState } from 'react';

import { api } from '../../api';
import { useT } from '../../i18n';
import type { HealthStatus, RadioIdentity, RadioIdentityList } from '../../types';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { CarryCheckbox, RadioIdentityResolver, useRadioLabel } from '../RadioIdentityPrompt';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { toast } from '../ui/sonner';

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

/**
 * Confirmation for removing a radio. The stat history is kept (as unassigned)
 * unless the box is ticked.
 */
function RemoveRadioDialog({
  radio,
  radios,
  onClose,
  onRemoved,
}: {
  radio: RadioIdentity;
  radios: RadioIdentity[];
  onClose: () => void;
  onRemoved: () => void;
}) {
  const t = useT();
  const radioLabel = useRadioLabel();
  const [deleteStats, setDeleteStats] = useState(false);
  const [busy, setBusy] = useState(false);
  const predecessor = radios.find((r) => r.replaced_by === radio.id);

  const remove = async () => {
    setBusy(true);
    try {
      await api.removeRadio(radio.id, deleteStats);
      toast.success(t('radio_identity_removed'));
      onClose();
      onRemoved();
    } catch (err) {
      toast.error(t('radio_identity_remove_failed'), {
        description: err instanceof Error ? err.message : undefined,
      });
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && !busy && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {t('radio_identity_remove_title', { radio: radioLabel(radio) })}
          </DialogTitle>
          <DialogDescription>{t('radio_identity_remove_desc')}</DialogDescription>
        </DialogHeader>
        {predecessor && (
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('radio_identity_remove_link_note', { radio: radioLabel(predecessor) })}
          </p>
        )}
        <div className="space-y-1.5">
          <CarryCheckbox
            id={`radio-remove-stats-${radio.id}`}
            checked={deleteStats}
            disabled={busy}
            label={t('radio_identity_remove_stats')}
            onChange={setDeleteStats}
          />
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('radio_identity_remove_stats_help')}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('common_cancel')}
          </Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={remove}>
            {t('radio_identity_remove')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RadioRow({
  radio,
  radios,
  onChanged,
}: {
  radio: RadioIdentity;
  radios: RadioIdentity[];
  onChanged: () => void;
}) {
  const t = useT();
  const radioLabel = useRadioLabel();
  const [notes, setNotes] = useState(radio.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const successor =
    radio.replaced_by !== null ? radios.find((r) => r.id === radio.replaced_by) : null;

  useEffect(() => {
    setNotes(radio.notes ?? '');
  }, [radio.notes]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      toast.success(t('radio_identity_saved'));
      onChanged();
    } catch (err) {
      toast.error(t('radio_identity_save_failed'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="space-y-3 rounded-md border border-input p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{radioLabel(radio)}</span>
        {radio.is_active && (
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider">
            {t('radio_identity_badge_active')}
          </span>
        )}
        {radio.status === 'pending' && (
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider text-warning">
            {t('radio_identity_badge_pending')}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('radio_identity_connected_range', {
          first: formatDateTime(new Date(radio.first_connected * 1000), DATE_OPTS),
          last: formatDateTime(new Date(radio.last_connected * 1000), DATE_OPTS),
        })}
      </p>

      {radio.status === 'pending' && (
        <RadioIdentityResolver identity={radio} radios={radios} onResolved={onChanged} />
      )}

      {successor && (
        <div className="space-y-2 rounded-md border border-input bg-muted/20 p-3">
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('radio_identity_replaced_by', { radio: radioLabel(successor) })}
          </p>
          <CarryCheckbox
            id={`radio-link-stats-${radio.id}`}
            checked={radio.carry_stats}
            disabled={busy}
            label={t('radio_identity_carry_stats')}
            onChange={(value) =>
              run(() =>
                api.updateRadioLink(radio.id, {
                  carry_stats: value,
                  carry_owned: radio.carry_owned,
                })
              )
            }
          />
          <CarryCheckbox
            id={`radio-link-owned-${radio.id}`}
            checked={radio.carry_owned}
            disabled={busy}
            label={t('radio_identity_carry_owned')}
            onChange={(value) =>
              run(() =>
                api.updateRadioLink(radio.id, {
                  carry_stats: radio.carry_stats,
                  carry_owned: value,
                })
              )
            }
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => run(() => api.removeRadioLink(radio.id))}
          >
            {t('radio_identity_remove_link')}
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input
          aria-label={t('radio_identity_notes_label')}
          placeholder={t('radio_identity_notes_placeholder')}
          value={notes}
          maxLength={500}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy || notes === (radio.notes ?? '')}
          onClick={() => run(() => api.updateRadioNotes(radio.id, notes || null))}
        >
          {t('radio_identity_notes_save')}
        </Button>
      </div>

      {!radio.is_active && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setRemoving(true)}
        >
          {t('radio_identity_remove')}
        </Button>
      )}
      {removing && (
        <RemoveRadioDialog
          radio={radio}
          radios={radios}
          onClose={() => setRemoving(false)}
          onRemoved={onChanged}
        />
      )}
    </li>
  );
}

/**
 * Plan 18: every radio that has fed this install, with pending answers,
 * replacement links (carry-over flags, undo), notes and removal of a radio
 * that is not the current one.
 */
export function RadioIdentitiesSettings({ health }: { health: HealthStatus | null }) {
  const t = useT();
  const [data, setData] = useState<RadioIdentityList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeId = health?.radio_identity?.id ?? null;
  const activeStatus = health?.radio_identity?.status ?? null;

  const load = useCallback(() => {
    api
      .getRadioIdentities()
      .then((list) => {
        setData(list);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    load();
  }, [load, activeId, activeStatus]);

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold tracking-tight">{t('radio_identity_heading')}</h3>
      <p className="text-[0.8125rem] text-muted-foreground">{t('radio_identity_settings_desc')}</p>
      {error && (
        <div className="text-sm text-destructive" role="alert">
          {error}
        </div>
      )}
      {data && data.radios.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('radio_identity_none')}</p>
      )}
      {data && data.radios.length > 0 && (
        <ul className="space-y-2">
          {data.radios.map((radio) => (
            <RadioRow key={radio.id} radio={radio} radios={data.radios} onChanged={load} />
          ))}
        </ul>
      )}
      {data?.has_unassigned_history && (
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('radio_identity_unassigned_note')}
        </p>
      )}
    </div>
  );
}
