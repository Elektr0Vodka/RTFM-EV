import { useCallback } from 'react';

import { api } from '../api';
import { useCliConsole } from '../hooks/useCliConsole';
import { useT } from '../i18n';
import { COMPANION_CLI_COMMANDS, isRiskyCompanionCommand } from '../utils/cliCommands';
import { ConsolePane } from './repeater/RepeaterConsolePane';

export type CompanionCliTarget = { kind: 'radio' } | { kind: 'contact'; publicKey: string };

/**
 * Command line of a MeshCore 1.18+ companion: our own radio (CMD_RUN_CLI_COMMAND,
 * never transmits) or another companion over the mesh (txt_type 3, answered
 * only when that contact gave us Remote CLI permission).
 */
export function CompanionCliConsole(props: { target: CompanionCliTarget; cliSupported: boolean }) {
  // Keyed per target: history belongs to one radio or contact and must not
  // carry over when a reused view switches to another contact.
  const targetKey = props.target.kind === 'contact' ? props.target.publicKey : 'radio';
  return <CompanionCliConsoleForTarget key={targetKey} {...props} />;
}

function CompanionCliConsoleForTarget({
  target,
  cliSupported,
}: {
  target: CompanionCliTarget;
  cliSupported: boolean;
}) {
  const t = useT();
  const publicKey = target.kind === 'contact' ? target.publicKey : null;
  const send = useCallback(
    async (command: string) =>
      publicKey === null
        ? (await api.runRadioCli(command)).reply
        : (await api.sendRepeaterCommand(publicKey, command)).response,
    [publicKey]
  );
  const { history, loading, sendCommand } = useCliConsole(send);
  const confirmCommand = useCallback(
    (command: string) =>
      !isRiskyCompanionCommand(command) || window.confirm(t('companion_cli_confirm', { command })),
    [t]
  );
  const title =
    target.kind === 'radio' ? t('companion_cli_title_radio') : t('companion_cli_title_contact');

  if (!cliSupported) {
    return (
      <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{title}: </span>
        {t('companion_cli_needs_firmware')}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {target.kind === 'contact' && (
        <p className="text-xs text-muted-foreground">{t('companion_cli_remote_hint')}</p>
      )}
      <ConsolePane
        history={history}
        loading={loading}
        onSend={sendCommand}
        commands={COMPANION_CLI_COMMANDS}
        title={title}
        confirmCommand={confirmCommand}
      />
    </div>
  );
}
