import { TerminalSquare } from 'lucide-react';

import { useT } from '../i18n';
import type { Message } from '../types';

/** An incoming MeshCore 1.18 CLI command (txt_type 3) from another companion. */
export function RemoteCliCommandRow({
  message,
  senderName,
}: {
  message: Message;
  senderName: string | null;
}) {
  const t = useT();
  const time = new Date(message.received_at * 1000).toLocaleTimeString();
  return (
    <div
      className="my-1 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 px-3 py-1.5 text-xs text-muted-foreground"
      data-testid="remote-cli-command"
    >
      <TerminalSquare className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{t('chat_remote_cli_command', { name: senderName ?? '?' })}</span>
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
        {message.text}
      </code>
      <span>
        {message.cli_permitted ? t('chat_remote_cli_answered') : t('chat_remote_cli_ignored')}
      </span>
      <span className="ml-auto">{time}</span>
    </div>
  );
}
