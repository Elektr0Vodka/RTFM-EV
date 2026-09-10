import { useMemo, useState } from 'react';

import type { Contact, PathDiscoveryResponse, PathDiscoveryRoute } from '../types';
import {
  findContactsByPrefix,
  formatForcedRouteSummary,
  formatLearnedRouteSummary,
  formatRouteLabel,
  parsePathHops,
} from '../utils/pathUtils';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { useT, type TFn } from '../i18n';

interface ContactPathDiscoveryModalProps {
  open: boolean;
  onClose: () => void;
  contact: Contact;
  contacts: Contact[];
  radioName: string | null;
  onDiscover: (publicKey: string) => Promise<PathDiscoveryResponse>;
}

function formatPathHashMode(mode: number, t: TFn): string {
  if (mode === 0) return t('path_discovery_hop_width_1byte');
  if (mode === 1) return t('path_discovery_hop_width_2byte');
  if (mode === 2) return t('path_discovery_hop_width_3byte');
  return t('path_discovery_hop_width_unknown');
}

function renderRouteNodes(
  route: PathDiscoveryRoute,
  startLabel: string,
  endLabel: string,
  contacts: Contact[]
): string {
  if (route.path_len <= 0 || !route.path) {
    return `${startLabel} -> ${endLabel}`;
  }

  const hops = parsePathHops(route.path, route.path_len).map((prefix) => {
    const matches = findContactsByPrefix(prefix, contacts, true);
    if (matches.length === 1) {
      return matches[0].name || `${matches[0].public_key.slice(0, prefix.length)}…`;
    }
    if (matches.length > 1) {
      return `${prefix}…?`;
    }
    return `${prefix}…`;
  });

  return [startLabel, ...hops, endLabel].join(' -> ');
}

function RouteCard({
  label,
  route,
  chain,
  t,
}: {
  label: string;
  route: PathDiscoveryRoute;
  chain: string;
  t: TFn;
}) {
  const rawPath = parsePathHops(route.path, route.path_len).join(' -> ') || t('contact_direct');

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold">{label}</h4>
        <span className="text-[0.6875rem] text-muted-foreground">
          {formatRouteLabel(route.path_len, true)}
        </span>
      </div>
      <p className="mt-2 text-sm">{chain}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
        <span>{t('path_discovery_raw_label', { path: rawPath })}</span>
        <span>{formatPathHashMode(route.path_hash_mode, t)}</span>
      </div>
    </div>
  );
}

export function ContactPathDiscoveryModal({
  open,
  onClose,
  contact,
  contacts,
  radioName,
  onDiscover,
}: ContactPathDiscoveryModalProps) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PathDiscoveryResponse | null>(null);

  const learnedRouteSummary = useMemo(() => formatLearnedRouteSummary(contact), [contact]);
  const forcedRouteSummary = useMemo(() => formatForcedRouteSummary(contact), [contact]);
  const hasForcedRoute = forcedRouteSummary !== null;

  const localRadioName = radioName || t('trace_local_radio_default');

  const forwardChain = result
    ? renderRouteNodes(
        result.forward_path,
        localRadioName,
        contact.name || contact.public_key.slice(0, 12),
        contacts
      )
    : null;
  const returnChain = result
    ? renderRouteNodes(
        result.return_path,
        contact.name || contact.public_key.slice(0, 12),
        localRadioName,
        contacts
      )
    : null;

  const handleDiscover = async () => {
    setLoading(true);
    setError(null);
    try {
      const discovered = await onDiscover(contact.public_key);
      setResult(discovered);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error_unknown'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('a11y_path_discovery')}</DialogTitle>
          <DialogDescription>{t('path_discovery_description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
            <div className="font-medium">{contact.name || contact.public_key.slice(0, 12)}</div>
            <div className="mt-1 text-muted-foreground">
              {t('path_current_learned_route_label')} {learnedRouteSummary}
            </div>
            {forcedRouteSummary && (
              <div className="mt-1 text-destructive">
                {t('path_current_forced_route_label')} {forcedRouteSummary}
              </div>
            )}
          </div>

          {hasForcedRoute && (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              {t('path_discovery_forced_route_warning')}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {result && forwardChain && returnChain && (
            <div className="space-y-3">
              <RouteCard
                label={t('path_discovery_forward_path_label')}
                route={result.forward_path}
                chain={forwardChain}
                t={t}
              />
              <RouteCard
                label={t('path_discovery_return_path_label')}
                route={result.return_path}
                chain={returnChain}
                t={t}
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="secondary" onClick={onClose}>
            {t('common_close')}
          </Button>
          <Button onClick={handleDiscover} disabled={loading}>
            {loading ? t('path_discovery_running') : t('path_discovery_run_button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
