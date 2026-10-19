import { useState } from 'react';

import { useT } from '../../i18n';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import type { WardriveMe } from '../api';
import type { RadioState } from '../account';

const MIN_PASSWORD = 10;

export interface RegisterInput {
  username: string;
  password: string;
  radioName: string;
}

export function AccountPanel({
  me,
  radioConnected,
  radioOnAccount,
  onLogin,
  onLogout,
  onRegister,
  onAddRadio,
}: {
  me: WardriveMe | null;
  radioConnected: boolean;
  radioOnAccount: RadioState | null;
  onLogin: (username: string, password: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onRegister: (input: RegisterInput) => Promise<void>;
  onAddRadio: () => Promise<void>;
}) {
  const t = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [radioName, setRadioName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const register = async () => {
    if (password.length < MIN_PASSWORD) {
      setProblem(t('wardrive_page_password_short'));
      return;
    }
    setProblem(null);
    await onRegister({ username, password, radioName });
    setRegistering(false);
  };

  const form = (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor="wardrive-username">{t('wardrive_page_username')}</Label>
        <Input
          id="wardrive-username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="wardrive-password">{t('wardrive_page_password')}</Label>
        <Input
          id="wardrive-password"
          type="password"
          autoComplete={registering ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {registering && (
        <div className="space-y-1">
          <Label htmlFor="wardrive-radio-name">{t('wardrive_page_radio_name')}</Label>
          <Input
            id="wardrive-radio-name"
            value={radioName}
            onChange={(e) => setRadioName(e.target.value)}
          />
        </div>
      )}
      {problem && (
        <p className="text-sm text-destructive" role="alert">
          {problem}
        </p>
      )}
    </div>
  );

  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <h2 className="text-base font-semibold">{t('wardrive_page_account_heading')}</h2>
      {me && !registering ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              {t('wardrive_page_logged_in_as', { name: me.username })}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void onLogout()}>
              {t('wardrive_page_log_out')}
            </Button>
          </div>
          {radioOnAccount === 'not-on-account' && (
            <div className="space-y-2 rounded-md bg-muted/40 p-2">
              <p className="text-sm">{t('wardrive_page_radio_not_on_account')}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => void onAddRadio()}>
                  {t('wardrive_page_add_to_account')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setRegistering(true)}
                >
                  {t('wardrive_page_separate_account')}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {form}
          <div className="flex flex-wrap gap-2">
            {registering ? (
              <Button type="button" onClick={() => void register()}>
                {t('wardrive_page_create_account')}
              </Button>
            ) : (
              <>
                <Button type="button" onClick={() => void onLogin(username, password)}>
                  {t('wardrive_page_log_in')}
                </Button>
                {radioConnected && (
                  <Button type="button" variant="outline" onClick={() => setRegistering(true)}>
                    {t('wardrive_page_create_account')}
                  </Button>
                )}
              </>
            )}
          </div>
          {!radioConnected && !registering && (
            <p className="text-xs text-muted-foreground">{t('wardrive_page_create_hint')}</p>
          )}
        </div>
      )}
    </section>
  );
}
