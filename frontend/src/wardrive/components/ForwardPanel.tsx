import { useT } from '../../i18n';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { BROKERS, destId, type BrokerId } from '../forward/brokers';
import type { ForwardStatus } from '../forward/forwarder';
import type { BrokerSettings } from '../forward/settings';

const NAME_KEYS: Record<BrokerId, string> = {
  'dmc-hunter': 'wardrive_page_broker_dmc_hunter',
  'dmc-wardriver': 'wardrive_page_broker_dmc_wardriver',
  on8ar: 'wardrive_page_broker_on8ar',
};

export function ForwardPanel({
  radioKey,
  settings,
  statuses,
  onToggle,
  onOn8arAccount,
  onSendNow,
}: {
  radioKey: string;
  settings: BrokerSettings;
  statuses: Record<string, ForwardStatus>;
  onToggle: (id: BrokerId, on: boolean) => void;
  onOn8arAccount: (username: string, password: string) => void;
  onSendNow: () => void;
}) {
  const t = useT();
  const account = settings.on8ar ?? { username: '', password: '' };
  const on8arReady = !!account.username && !!account.password;

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
        {BROKERS.map((broker) => {
          const dest = destId(broker.id, radioKey);
          const on = !!settings.enabled[dest];
          const disabled = broker.auth === 'password' && !on8arReady && !on;
          return (
            <li key={broker.id} className="space-y-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={disabled}
                  onChange={(e) => onToggle(broker.id, e.target.checked)}
                />
                {t(NAME_KEYS[broker.id])}
              </label>
              <p className="pl-6 text-xs text-muted-foreground">{statusLine(statuses[dest], on)}</p>
              {broker.auth === 'password' && (
                <div className="grid gap-2 pl-6 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="wardrive-on8ar-user">{t('wardrive_page_on8ar_username')}</Label>
                    <Input
                      id="wardrive-on8ar-user"
                      autoComplete="off"
                      value={account.username}
                      onChange={(e) => onOn8arAccount(e.target.value, account.password)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="wardrive-on8ar-pass">{t('wardrive_page_on8ar_password')}</Label>
                    <Input
                      id="wardrive-on8ar-pass"
                      type="password"
                      autoComplete="off"
                      value={account.password}
                      onChange={(e) => onOn8arAccount(account.username, e.target.value)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    {t('wardrive_page_on8ar_note')}
                  </p>
                </div>
              )}
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
