// What the SNMP overview and the node page both need to know about one node.

import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '../../i18n';
import type { SnmpNodeOverview, SnmpPollResponse } from '../../types';

export type SnmpNodeStatus = 'failing' | 'never' | 'ok';

const STATUS_LABEL_KEY: Record<SnmpNodeStatus, string> = {
  failing: 'snmp_page_status_failing',
  never: 'snmp_page_status_never',
  ok: 'snmp_page_status_ok',
};

/** A node whose most recent poll failed is failing; a good poll clears the error. */
export function snmpNodeStatus(node: SnmpNodeOverview): SnmpNodeStatus {
  if (node.last_error) return 'failing';
  return node.last_ok_at ? 'ok' : 'never';
}

export function snmpNodeName(node: SnmpNodeOverview): string {
  return node.name || `${node.public_key.slice(0, 12)}...`;
}

/** The node after one poll: same bookkeeping as the server does on the settings row. */
export function applySnmpPoll(node: SnmpNodeOverview, result: SnmpPollResponse): SnmpNodeOverview {
  if (!result.ok) {
    return { ...node, last_error: result.error, last_error_at: result.timestamp };
  }
  return {
    ...node,
    last_ok_at: result.timestamp,
    last_error: null,
    last_error_at: null,
    latest: { timestamp: result.timestamp, values: result.values ?? {} },
  };
}

export function SnmpStatusBadge({ status }: { status: SnmpNodeStatus }) {
  const t = useT();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
        status === 'failing' && 'bg-destructive text-destructive-foreground',
        status === 'ok' && 'bg-success/15 text-success',
        status === 'never' && 'bg-muted text-muted-foreground'
      )}
    >
      {status === 'failing' && <AlertTriangle className="h-3 w-3" aria-hidden />}
      {t(STATUS_LABEL_KEY[status])}
    </span>
  );
}
