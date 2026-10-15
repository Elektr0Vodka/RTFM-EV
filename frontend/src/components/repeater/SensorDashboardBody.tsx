import { Button } from '../ui/button';
import { RepeaterLogin } from '../RepeaterLogin';
import { ServerLoginStatusBanner } from '../ServerLoginStatusBanner';
import { useRememberedServerPassword } from '../../hooks/useRememberedServerPassword';
import { useRepeaterDashboard } from '../../hooks/useRepeaterDashboard';
import { isValidLocation } from '../../utils/pathUtils';
import type { Contact, Conversation } from '../../types';
import { LppTelemetryPane } from './RepeaterLppTelemetryPane';
import { AclPane } from './RepeaterAclPane';
import { ConsolePane } from './RepeaterConsolePane';
import { SensorMmaPane } from './SensorMmaPane';
import { SensorPushPane } from './SensorPushPane';
import { useT } from '../../i18n';

/**
 * Login + panes for a sensor node (stock `simple_sensor`). A sensor answers
 * login, telemetry, min/max/avg, ACL and its CLI, but not the repeater status,
 * neighbour, region or config requests, so those panes are left out.
 */
export function SensorDashboardBody({
  conversation,
  contacts,
}: {
  conversation: Conversation;
  contacts: Contact[];
}) {
  const t = useT();
  const contact = contacts.find((c) => c.public_key === conversation.id) ?? null;
  const hasAdvertLocation = isValidLocation(contact?.lat ?? null, contact?.lon ?? null);
  const {
    loggedIn,
    loginLoading,
    loginError,
    lastLoginAttempt,
    paneData,
    paneStates,
    consoleHistory,
    consoleLoading,
    login,
    loginAsGuest,
    refreshPane,
    loadAll,
    sendConsoleCommand,
  } = useRepeaterDashboard(conversation, { hasAdvertLocation, role: 'sensor' });
  const { password, setPassword, rememberPassword, setRememberPassword, persistAfterLogin } =
    useRememberedServerPassword('sensor', conversation.id);

  const handleLogin = async (nextPassword: string) => {
    await login(nextPassword);
    persistAfterLogin(nextPassword);
  };
  const handleGuestLogin = async () => {
    await loginAsGuest();
    persistAfterLogin('');
  };

  const anyLoading = [paneStates.lppTelemetry, paneStates.mma, paneStates.acl].some(
    (s) => s.loading
  );

  if (!loggedIn) {
    return (
      <RepeaterLogin
        repeaterName={conversation.name}
        loading={loginLoading}
        error={loginError}
        password={password}
        onPasswordChange={setPassword}
        rememberPassword={rememberPassword}
        onRememberPasswordChange={setRememberPassword}
        onLogin={handleLogin}
        onLoginAsGuest={handleGuestLogin}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <ServerLoginStatusBanner
          attempt={lastLoginAttempt}
          loading={loginLoading}
          canRetryPassword={password.trim().length > 0}
          onRetryPassword={() => handleLogin(password)}
          onRetryBlank={handleGuestLogin}
          blankRetryLabel={t('repeater_retry_existing_access_login')}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={loadAll}
          disabled={anyLoading}
          className="h-7 shrink-0 px-2 text-[0.6875rem] leading-none border-success text-success hover:bg-success/10 hover:text-success sm:h-8 sm:px-3 sm:text-xs"
        >
          {anyLoading ? t('common_loading') : t('repeater_load_all')}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-stretch">
        <div className="flex flex-col gap-4">
          <LppTelemetryPane
            data={paneData.lppTelemetry}
            state={paneStates.lppTelemetry}
            onRefresh={() => refreshPane('lppTelemetry')}
            disabled={anyLoading}
          />
          <SensorMmaPane
            data={paneData.mma}
            state={paneStates.mma}
            onRefresh={() => refreshPane('mma')}
            disabled={anyLoading}
          />
        </div>
        <div className="flex flex-col gap-4">
          <AclPane
            data={paneData.acl}
            state={paneStates.acl}
            onRefresh={() => refreshPane('acl')}
            disabled={anyLoading}
          />
          <SensorPushPane
            publicKey={conversation.id}
            channels={(paneData.lppTelemetry?.sensors ?? []).map((s) => ({
              channel: s.channel,
              type_name: s.type_name,
            }))}
          />
        </div>
      </div>
      <ConsolePane history={consoleHistory} loading={consoleLoading} onSend={sendConsoleCommand} />
    </div>
  );
}
