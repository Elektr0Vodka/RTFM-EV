import { useT } from '../../i18n';
import { Button } from '../../components/ui/button';
import { destId, type Broker, type BrokerId } from '../forward/brokers';
import type { ForwardStatus } from '../forward/forwarder';
import type { BrokerSettings } from '../forward/settings';

// The DMC built-ins keep their translated names; every other broker shows the
// name the owner gave it.
const NAME_KEYS: Record<string, string> = {
  'dmc-hunter': 'wardrive_page_broker_dmc_hunter',
  'dmc-wardriver': 'wardrive_page_broker_dmc_wardriver',
};

export function ForwardPanel({
  radioKey,
  brokers,
  settings,
  statuses,
  onToggle,
  onSendNow,
}: {
  radioKey: string;
  brokers: Broker[];
  settings: BrokerSettings;
  statuses: Record<string, ForwardStatus>;
  onToggle: (id: BrokerId, on: boolean) => void;
  onSendNow: () => void;
}) {
  const t = useT();

  const statusLine = (s: ForwardStatus | undefined, on: boolean) => {
    if (!on || !s) return t('wardrive_page_forward_off');
    switch (s.state) {
      case 'off':
        return t('wardrive_page_forward_off');
      case 'connecting':
        return t('wardrive_page_forward_connecting');
      case 'connected':
        return t('wardrive_page_forward_connected', { count: s.pending });
      case 'sign-failed':
        return t('wardrive_page_forward_sign_failed');
      case 'error':
        return t('wardrive_page_forward_error', { error: s.lastError ?? '?' });
    }
  };

  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <h2 className="text-base font-semibold">{t('wardrive_page_forward_heading')}</h2>
      <p className="text-xs text-muted-foreground">{t('wardrive_page_forward_note')}</p>
      <ul className="space-y-2">
        {brokers.map((broker) => {
          const dest = destId(broker.id, radioKey);
          const on = !!settings.enabled[dest];
          return (
            <li key={broker.id} className="space-y-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => onToggle(broker.id, e.target.checked)}
                />
                {NAME_KEYS[broker.id] ? t(NAME_KEYS[broker.id]) : broker.name}
              </label>
              <p className="pl-6 text-xs text-muted-foreground">{statusLine(statuses[dest], on)}</p>
            </li>
          );
        })}
      </ul>
      <Button type="button" size="sm" variant="outline" onClick={onSendNow}>
        {t('wardrive_page_send_now')}
      </Button>
    </section>
  );
}
