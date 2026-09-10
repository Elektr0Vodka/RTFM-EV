import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useT } from '../../i18n';

// MeshCore / Dutch MeshCore CLI command reference. The DMC toolbox wiki covers
// the meshcore, dmc-repeater and dmc-mqtt firmware variants this fork talks to.
const CLI_DOCS_URL = 'https://toolbox.dutchmeshcore.nl/#/cli-wiki';

export function ConsolePane({
  history,
  loading,
  onSend,
}: {
  history: Array<{ command: string; response: string; timestamp: number; outgoing: boolean }>;
  loading: boolean;
  onSend: (command: string) => Promise<void>;
}) {
  const t = useT();
  const [input, setInput] = useState('');
  // -1 = editing the live input; 0+ = index into sentCommands (most recent first)
  const [historyIndex, setHistoryIndex] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevLoadingRef = useRef(loading);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  // Refocus input after command completes
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      inputRef.current?.focus();
    }
    prevLoadingRef.current = loading;
  }, [loading]);

  // Most-recent-first list of sent commands, with consecutive repeats deduped
  const sentCommands = history.reduce<string[]>((acc, entry) => {
    if (entry.outgoing && entry.command !== acc[0]) acc.unshift(entry.command);
    return acc;
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (sentCommands.length === 0) return;
      e.preventDefault();
      const next = e.key === 'ArrowUp' ? historyIndex + 1 : historyIndex - 1;
      if (next >= sentCommands.length || next < -1) return;
      setHistoryIndex(next);
      setInput(next === -1 ? '' : sentCommands[next]);
    },
    [historyIndex, sentCommands]
  );

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const trimmed = input.trimStart();
      if (!trimmed || loading) return;
      setInput('');
      setHistoryIndex(-1);
      await onSend(trimmed);
    },
    [input, loading, onSend]
  );

  return (
    <div className="border border-border rounded-lg overflow-hidden col-span-full">
      <div className="px-3 py-2 bg-muted/50 border-b border-border flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('repeater_console_title')}</h3>
        <a
          href={CLI_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline"
        >
          {t('repeater_console_cli_docs')}
        </a>
      </div>
      <div
        ref={outputRef}
        className="h-48 overflow-y-auto p-3 font-mono text-xs bg-console-bg/50 text-console space-y-1"
      >
        {history.length === 0 && (
          <p className="text-muted-foreground italic">{t('repeater_console_placeholder_text')}</p>
        )}
        {history.map((entry, i) =>
          entry.outgoing ? (
            <div key={i} className="text-console-command">
              &gt; {entry.command}
            </div>
          ) : (
            <div key={i} className="text-console/80 whitespace-pre-wrap">
              {entry.response}
            </div>
          )
        )}
        {loading && <div className="text-muted-foreground animate-pulse">...</div>}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 p-2 border-t border-border">
        <Input
          ref={inputRef}
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          name="console-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('repeater_console_input_placeholder')}
          aria-label={t('repeater_console_input_aria')}
          disabled={loading}
          className="flex-1 font-mono text-sm"
        />
        <Button type="submit" size="sm" disabled={loading || !input.trimStart()}>
          {t('common_send')}
        </Button>
      </form>
    </div>
  );
}
