import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useT } from '../../i18n';
import type { ChannelSet, ChannelSetApplyResult } from '../../types';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Label } from '../ui/label';
import { ApplyResultList } from './ChannelSetsSettings';

interface LoadoutDisconnectDialogProps {
  /** Loadouts to choose from; the dialog is open while this is non-null. */
  sets: ChannelSet[] | null;
  onCancel: () => void;
  /** Go ahead with the disconnect (with or without a loadout loaded). */
  onDisconnect: () => void;
}

/**
 * Plan 08 slice 3: before disconnecting, offer to load a loadout onto the
 * radio so it keeps working without the server. When anything fails to load,
 * the results are shown and the user decides whether to disconnect anyway.
 * Loading uses local radio commands only; nothing is transmitted.
 */
export function LoadoutDisconnectDialog({
  sets,
  onCancel,
  onDisconnect,
}: LoadoutDisconnectDialogProps) {
  const t = useT();
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ChannelSetApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sets) return;
    setSelectedId(sets[0]?.id ?? '');
    setBusy(false);
    setResult(null);
    setError(null);
  }, [sets]);

  const loadAndDisconnect = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const applied = await api.applyChannelSet(selectedId);
      if (applied.failed === 0) {
        onDisconnect();
        return;
      }
      setResult(applied);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('channel_sets_apply_failed'));
    } finally {
      setBusy(false);
    }
  };

  const needsConfirm = result !== null || error !== null;

  return (
    <Dialog open={sets !== null} onOpenChange={(isOpen) => !isOpen && !busy && onCancel()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {needsConfirm ? t('loadout_disconnect_failed_title') : t('loadout_disconnect_title')}
          </DialogTitle>
          <DialogDescription>
            {needsConfirm ? t('loadout_disconnect_failed_desc') : t('loadout_disconnect_desc')}
          </DialogDescription>
        </DialogHeader>

        {needsConfirm ? (
          <div className="space-y-2">
            {error && <p className="text-sm text-destructive">{error}</p>}
            {result && (
              <>
                <p className="text-sm">
                  {t('channel_sets_apply_summary', {
                    loaded: result.loaded,
                    already: result.already_loaded,
                    failed: result.failed,
                  })}
                </p>
                <div className="max-h-56 overflow-y-auto">
                  <ApplyResultList result={result} />
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="loadout-disconnect-select">
              {t('loadout_disconnect_select_label')}
            </Label>
            <select
              id="loadout-disconnect-select"
              value={selectedId}
              disabled={busy}
              onChange={(e) => setSelectedId(e.target.value)}
              className="block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {(sets ?? []).map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <DialogFooter className="gap-2 sm:block sm:space-x-0">
          <div className="space-y-2">
            {needsConfirm ? (
              <Button type="button" className="w-full" onClick={onDisconnect}>
                {t('loadout_disconnect_anyway')}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  className="w-full"
                  disabled={busy || !selectedId}
                  onClick={() => void loadAndDisconnect()}
                >
                  {busy ? t('channel_sets_applying') : t('loadout_disconnect_load_and_disconnect')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={busy}
                  onClick={onDisconnect}
                >
                  {t('loadout_disconnect_skip')}
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={onCancel}
            >
              {t('channel_sets_cancel')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
