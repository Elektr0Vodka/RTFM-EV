import { useEffect, useRef, useState } from 'react';

import { api } from '../../api';
import { Button } from '../ui/button';
import { RepeaterLogin } from '../RepeaterLogin';
import { ServerLoginStatusBanner } from '../ServerLoginStatusBanner';
import { useRememberedServerPassword } from '../../hooks/useRememberedServerPassword';
import { useRepeaterDashboard } from '../../hooks/useRepeaterDashboard';
import { isValidLocation } from '../../utils/pathUtils';
import type { Contact, Conversation, TelemetryHistoryEntry } from '../../types';
import { TelemetryPane } from './RepeaterTelemetryPane';
import { NeighborsPane } from './RepeaterNeighborsPane';
import { AclPane } from './RepeaterAclPane';
import { NodeInfoPane } from './RepeaterNodeInfoPane';
import { RadioSettingsPane } from './RepeaterRadioSettingsPane';
import { LppTelemetryPane } from './RepeaterLppTelemetryPane';
import { OwnerInfoPane } from './RepeaterOwnerInfoPane';
import { RegionsPane } from './RepeaterRegionsPane';
import { ActionsPane } from './RepeaterActionsPane';
import { ConsolePane } from './RepeaterConsolePane';
import { TelemetryHistoryPane } from './RepeaterTelemetryHistoryPane';
import { useT } from '../../i18n';

interface RepeaterDashboardBodyProps {
  conversation: Conversation;
  contacts: Contact[];
  trackedTelemetryRepeaters: string[];
  onToggleTrackedTelemetry: (publicKey: string) => Promise<void>;
  onSeedKnownRegions?: (codes: string[]) => Promise<number>;
  autoLoginAndLoadAll?: boolean;
  onAutoLoginConsumed?: () => void;
}

/**
 * The login form + logged-in pane grid of the repeater dashboard, without the
 * standalone header. Shared by `RepeaterDashboard` (mobile standalone view) and
 * the embedded, minimizable login region in `ContactInfoView` (desktop). Owns
 * the dashboard hook, remembered-password hook, and telemetry-history state.
 */
export function RepeaterDashboardBody({
  conversation,
  contacts,
  trackedTelemetryRepeaters,
  onToggleTrackedTelemetry,
  onSeedKnownRegions,
  autoLoginAndLoadAll,
  onAutoLoginConsumed,
}: RepeaterDashboardBodyProps) {
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
    sendZeroHopAdvert,
    sendFloodAdvert,
    rebootRepeater,
    syncClock,
  } = useRepeaterDashboard(conversation, { hasAdvertLocation });
  const { password, setPassword, rememberPassword, setRememberPassword, persistAfterLogin } =
    useRememberedServerPassword('repeater', conversation.id);

  // Telemetry history: preload from stored data, refresh from live status
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryHistoryEntry[]>([]);
  const telemetryHistorySourceRef = useRef<'none' | 'preload' | 'live'>('none');
  const telemetryHistoryRequestRef = useRef(0);

  useEffect(() => {
    telemetryHistoryRequestRef.current += 1;
    telemetryHistorySourceRef.current = 'none';
    setTelemetryHistory([]);

    if (!loggedIn) return;

    const requestId = telemetryHistoryRequestRef.current;
    api
      .repeaterTelemetryHistory(conversation.id)
      .then((history) => {
        if (telemetryHistoryRequestRef.current !== requestId) return;
        if (telemetryHistorySourceRef.current === 'live') return;
        telemetryHistorySourceRef.current = 'preload';
        setTelemetryHistory(history);
      })
      .catch(() => {});
  }, [loggedIn, conversation.id]);

  // When a live status fetch returns embedded telemetry_history, replace local state
  useEffect(() => {
    const liveHistory = paneData.status?.telemetry_history;
    if (!liveHistory) return;
    telemetryHistorySourceRef.current = 'live';
    setTelemetryHistory(liveHistory);
  }, [paneData.status?.telemetry_history]);

  // Command palette "ACL login + load all" auto-action
  const autoLoginConsumedRef = useRef(false);
  useEffect(() => {
    if (!autoLoginAndLoadAll || autoLoginConsumedRef.current) return;
    autoLoginConsumedRef.current = true;
    onAutoLoginConsumed?.();
    void loginAsGuest().then(() => loadAll());
  }, [autoLoginAndLoadAll, onAutoLoginConsumed, loginAsGuest, loadAll]);

  const handleRepeaterLogin = async (nextPassword: string) => {
    await login(nextPassword);
    persistAfterLogin(nextPassword);
  };
  const handleRepeaterGuestLogin = async () => {
    await loginAsGuest();
    persistAfterLogin('');
  };

  const anyLoading = Object.values(paneStates).some((s) => s.loading);

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
        onLogin={handleRepeaterLogin}
        onLoginAsGuest={handleRepeaterGuestLogin}
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
          onRetryPassword={() => handleRepeaterLogin(password)}
          onRetryBlank={handleRepeaterGuestLogin}
          blankRetryLabel={t('repeater_retry_existing_access_login')}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={loadAll}
          disabled={anyLoading}
          className="h-7 flex-shrink-0 px-2 text-[0.6875rem] leading-none border-success text-success hover:bg-success/10 hover:text-success sm:h-8 sm:px-3 sm:text-xs"
        >
          {anyLoading ? t('common_loading') : t('repeater_load_all')}
        </Button>
      </div>
      {/* Top row: Telemetry + Radio Settings | Node Info + Neighbors */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-stretch">
        <div className="flex flex-col gap-4">
          <NodeInfoPane
            data={paneData.nodeInfo}
            state={paneStates.nodeInfo}
            onRefresh={() => refreshPane('nodeInfo')}
            disabled={anyLoading}
          />
          <TelemetryPane
            data={paneData.status}
            state={paneStates.status}
            onRefresh={() => refreshPane('status')}
            disabled={anyLoading}
          />
          <RadioSettingsPane
            data={paneData.radioSettings}
            state={paneStates.radioSettings}
            onRefresh={() => refreshPane('radioSettings')}
            disabled={anyLoading}
            advertData={paneData.advertIntervals}
            advertState={paneStates.advertIntervals}
            onRefreshAdvert={() => refreshPane('advertIntervals')}
          />
          <LppTelemetryPane
            data={paneData.lppTelemetry}
            state={paneStates.lppTelemetry}
            onRefresh={() => refreshPane('lppTelemetry')}
            disabled={anyLoading}
          />
        </div>
        <div className="flex min-h-0 flex-col gap-4">
          <NeighborsPane
            data={paneData.neighbors}
            state={paneStates.neighbors}
            onRefresh={() => refreshPane('neighbors')}
            disabled={anyLoading}
            repeaterContact={contact}
            contacts={contacts}
            nodeInfo={paneData.nodeInfo}
            nodeInfoState={paneStates.nodeInfo}
            repeaterName={conversation.name}
          />
        </div>
      </div>

      {/* Remaining panes: ACL + Regions | Owner Info + Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-4">
          <AclPane
            data={paneData.acl}
            state={paneStates.acl}
            onRefresh={() => refreshPane('acl')}
            disabled={anyLoading}
          />
          <RegionsPane
            data={paneData.regions}
            state={paneStates.regions}
            onRefresh={() => refreshPane('regions')}
            disabled={anyLoading}
            onSeedKnownRegions={onSeedKnownRegions}
          />
        </div>
        <div className="flex flex-col gap-4">
          <OwnerInfoPane
            data={paneData.ownerInfo}
            state={paneStates.ownerInfo}
            onRefresh={() => refreshPane('ownerInfo')}
            disabled={anyLoading}
            publicKey={conversation.id}
            onSaveOwnerInfo={async (pk, info) => {
              await api.updateContactAnnotations(pk, { owner_info: info });
              await refreshPane('ownerInfo');
            }}
          />
          <ActionsPane
            onSendZeroHopAdvert={sendZeroHopAdvert}
            onSendFloodAdvert={sendFloodAdvert}
            onSyncClock={syncClock}
            onReboot={rebootRepeater}
            consoleLoading={consoleLoading}
          />
        </div>
      </div>

      {/* Console - full width */}
      <ConsolePane history={consoleHistory} loading={consoleLoading} onSend={sendConsoleCommand} />

      {/* Telemetry history chart - full width, below console */}
      <TelemetryHistoryPane
        entries={telemetryHistory}
        publicKey={conversation.id}
        contacts={contacts}
        trackedTelemetryRepeaters={trackedTelemetryRepeaters}
        onToggleTrackedTelemetry={onToggleTrackedTelemetry}
      />
    </div>
  );
}
