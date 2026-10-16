import { useT } from '../../i18n';
import type { SnmpValues } from '../../types';
import { SNMP_FIELDS, SNMP_GROUPS, formatSnmpValue, snmpValueServed } from './snmpFields';

/**
 * The SNMP values of one poll, grouped as in `snmpFields.ts`. A field added
 * after the first firmware release is left out when the node did not serve it,
 * and so is a group with nothing left. `className` lays the groups out:
 * stacked on the contact card, a grid on the SNMP page.
 */
export function SnmpValueGroups({ values, className }: { values: SnmpValues; className?: string }) {
  const t = useT();
  return (
    <div className={className} data-testid="snmp-values">
      {SNMP_GROUPS.map(({ group, labelKey }) => {
        const fields = SNMP_FIELDS.filter(
          (field) => field.group === group && (!field.optional || snmpValueServed(field, values))
        );
        if (fields.length === 0) return null;
        return (
          <div key={group} data-testid={`snmp-group-${group}`}>
            <div className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
              {t(labelKey)}
            </div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 text-xs">
              {fields.map((field) => (
                <div key={field.key} className="contents" data-testid={`snmp-row-${field.key}`}>
                  <dt className="text-muted-foreground">{t(field.labelKey)}</dt>
                  <dd className="text-right font-mono">{formatSnmpValue(field, values, t)}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
