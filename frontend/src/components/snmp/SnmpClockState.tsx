import { useT } from '../../i18n';

/**
 * The node's clock as SNMP reports it (`ntp_synced`: the firmware set its clock
 * from NTP). Nothing is shown when the node does not serve the value.
 */
export function SnmpClockState({ synced }: { synced: boolean | null | undefined }) {
  const t = useT();
  if (synced == null) return null;
  return synced ? (
    <p className="text-[0.6875rem] text-muted-foreground" data-testid="snmp-clock">
      {t('snmp_clock_synced')}
    </p>
  ) : (
    <p className="text-xs text-warning" role="alert" data-testid="snmp-clock">
      {t('snmp_clock_not_synced')}
    </p>
  );
}

/** `ntp_synced` from a stored poll's values, or null when absent. */
export function ntpSyncedFromValues(
  values: Record<string, number | string | null> | null | undefined
): boolean | null {
  const raw = values?.ntp_synced;
  return typeof raw === 'number' ? raw !== 0 : null;
}
