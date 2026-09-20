import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { toast } from '../ui/sonner';
import { useT } from '../../i18n';
import type { PartialResolutionPreview, PartialResolutionApplyItem } from '../../types';

interface PartialNodeSyncModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Reviews soft resolutions for partial nodes (prefix-only placeholder contacts
 * and hop hashes seen in paths) matched against the external-map cache. Nothing
 * is persisted until the user confirms the checked rows with Apply.
 */
export function PartialNodeSyncModal({ open, onClose }: PartialNodeSyncModalProps) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PartialResolutionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    api
      .previewPartialResolutions()
      .then((res) => {
        if (cancelled) return;
        setPreview(res);
        // Default: unambiguous (single-candidate) rows checked; ambiguous opt-in.
        setChecked(
          new Set(res.resolutions.filter((r) => r.candidate_count === 1).map((r) => r.prefix_hex))
        );
        setChosen({});
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const seenAsLabel = useCallback(
    (seenAs: string) => {
      if (seenAs === 'both') return t('partial_sync_seen_both');
      if (seenAs === 'path') return t('partial_sync_seen_path');
      return t('partial_sync_seen_placeholder');
    },
    [t]
  );

  const toggle = (prefix: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next;
    });
  };

  const selections: PartialResolutionApplyItem[] = useMemo(() => {
    if (!preview) return [];
    const items: PartialResolutionApplyItem[] = [];
    for (const r of preview.resolutions) {
      if (!checked.has(r.prefix_hex)) continue;
      const candidate = r.candidates[chosen[r.prefix_hex] ?? 0];
      if (!candidate) continue;
      items.push({
        prefix_hex: r.prefix_hex,
        resolved_pubkey: candidate.pubkey,
        resolved_name: candidate.name,
        confidence: candidate.confidence,
        candidate_count: r.candidate_count,
      });
    }
    return items;
  }, [preview, checked, chosen]);

  const handleApply = async () => {
    if (selections.length === 0) return;
    setApplying(true);
    try {
      const res = await api.applyPartialResolutions(selections);
      const skipped = (preview?.resolutions.length ?? 0) - res.applied;
      toast.success(t('partial_sync_toast_applied', { count: res.applied, skipped }));
      onClose();
    } catch (err) {
      toast.error(t('partial_sync_toast_failed'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('partial_sync_title')}</DialogTitle>
          <DialogDescription>{t('partial_sync_description')}</DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {t('partial_sync_loading')}
          </div>
        )}

        {!loading && error && <div className="p-4 text-center text-sm text-warning">{error}</div>}

        {!loading && !error && preview && preview.reason && (
          <div className="p-4 text-center text-sm text-muted-foreground">{preview.reason}</div>
        )}

        {!loading && !error && preview && !preview.reason && (
          <>
            {preview.resolutions.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {t('partial_sync_no_proposals')}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto min-h-0 border border-border rounded-md divide-y divide-border">
                {preview.resolutions.map((r) => {
                  const candidate = r.candidates[chosen[r.prefix_hex] ?? 0];
                  return (
                    <div key={r.prefix_hex} className="flex items-start gap-3 p-3">
                      <input
                        type="checkbox"
                        className="mt-1 rounded border-input"
                        checked={checked.has(r.prefix_hex)}
                        onChange={() => toggle(r.prefix_hex)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="font-mono text-xs text-muted-foreground">
                            {r.prefix_hex}
                          </code>
                          <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
                            {seenAsLabel(r.seen_as)}
                          </span>
                          {candidate && (
                            <span className="text-[0.6875rem] text-muted-foreground">
                              {t('partial_sync_confidence', {
                                value: Math.round(candidate.confidence * 100),
                              })}
                            </span>
                          )}
                        </div>
                        {r.candidate_count > 1 ? (
                          <select
                            value={chosen[r.prefix_hex] ?? 0}
                            onChange={(e) =>
                              setChosen((prev) => ({
                                ...prev,
                                [r.prefix_hex]: Number(e.target.value),
                              }))
                            }
                            className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                          >
                            {r.candidates.map((c, i) => (
                              <option key={c.pubkey} value={i}>
                                {(c.name || c.pubkey.slice(0, 12)) +
                                  (c.distance_km != null
                                    ? ` · ${t('partial_sync_distance_km', { km: c.distance_km })}`
                                    : '')}
                              </option>
                            ))}
                          </select>
                        ) : (
                          candidate && (
                            <div className="mt-0.5 text-sm">
                              <span className="font-medium">
                                {candidate.name || candidate.pubkey.slice(0, 12)}
                              </span>
                              <span className="ml-2 font-mono text-xs text-muted-foreground">
                                {candidate.pubkey.slice(0, 16)}
                              </span>
                            </div>
                          )
                        )}
                        {r.candidate_count > 1 && (
                          <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                            {t('partial_sync_candidate_count', { count: r.candidate_count })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {preview.unmatched.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {t('partial_sync_unmatched', { count: preview.unmatched.length })}
                </summary>
                <div className="mt-1 font-mono break-all">{preview.unmatched.join(', ')}</div>
              </details>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={onClose} disabled={applying}>
                {t('common_cancel')}
              </Button>
              <Button onClick={handleApply} disabled={applying || selections.length === 0}>
                {applying
                  ? t('partial_sync_apply_button_loading')
                  : t('partial_sync_apply_button', { count: selections.length })}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
