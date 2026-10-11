import {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useT } from '../../i18n';
import { cn } from '@/lib/utils';
import { commandPrefix, matchCliCommands, type CliCommand } from '../../utils/cliCommands';

// MeshCore / Dutch MeshCore CLI command reference. The DMC toolbox wiki covers
// the meshcore, dmc-repeater and dmc-mqtt firmware variants this fork talks to.
const CLI_DOCS_URL = 'https://toolbox.dutchmeshcore.nl/#/cli-wiki';

const SUGGESTION_LIST_ID = 'repeater-console-suggestions';

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
  // null = nothing highlighted yet; Enter then sends what is typed.
  const [suggestionIndex, setSuggestionIndex] = useState<number | null>(null);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
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
    if (entry.outgoing && entry.command !== '' && entry.command !== acc[0]) {
      acc.unshift(entry.command);
    }
    return acc;
  }, []);

  // Type-ahead over the static command table. It only ever fills the input:
  // nothing is sent until the user presses Send or Enter on their own text.
  // Hidden while stepping through history, so the arrows keep recalling.
  const suggestions = useMemo(() => matchCliCommands(input), [input]);
  const showSuggestions =
    suggestions.length > 0 && !suggestionsDismissed && historyIndex === -1 && !loading;

  const acceptSuggestion = useCallback((cmd: CliCommand) => {
    const prefix = commandPrefix(cmd.syntax);
    // A command with parameters gets a trailing space, ready for the first one.
    setInput(prefix === cmd.syntax ? prefix : `${prefix} `);
    setSuggestionIndex(null);
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (showSuggestions) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSuggestionIndex((prev) =>
            prev === null ? 0 : Math.min(prev + 1, suggestions.length - 1)
          );
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSuggestionIndex((prev) =>
            prev === null ? suggestions.length - 1 : Math.max(prev - 1, 0)
          );
          return;
        }
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          acceptSuggestion(suggestions[suggestionIndex ?? 0]);
          return;
        }
        if (e.key === 'Enter' && suggestionIndex !== null) {
          e.preventDefault();
          acceptSuggestion(suggestions[suggestionIndex]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setSuggestionsDismissed(true);
          setSuggestionIndex(null);
          return;
        }
      }

      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (sentCommands.length === 0) return;
      e.preventDefault();
      const next = e.key === 'ArrowUp' ? historyIndex + 1 : historyIndex - 1;
      if (next >= sentCommands.length || next < -1) return;
      setHistoryIndex(next);
      setInput(next === -1 ? '' : sentCommands[next]);
    },
    [acceptSuggestion, historyIndex, sentCommands, showSuggestions, suggestionIndex, suggestions]
  );

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (loading) return;
      // Sent as typed. The firmware's `region load` reads leading spaces as
      // the nesting depth of a line and an empty line as the end of the load.
      const command = input;
      setInput('');
      setHistoryIndex(-1);
      setSuggestionIndex(null);
      setSuggestionsDismissed(false);
      await onSend(command);
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
            <div key={i} className="text-console-command whitespace-pre-wrap">
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
      {showSuggestions && (
        <ul
          id={SUGGESTION_LIST_ID}
          role="listbox"
          aria-label={t('repeater_console_suggestions_aria')}
          className="max-h-40 overflow-y-auto border-t border-border bg-popover text-popover-foreground"
        >
          {suggestions.map((cmd, i) => (
            <li
              key={cmd.syntax}
              id={`${SUGGESTION_LIST_ID}-${i}`}
              role="option"
              aria-selected={i === suggestionIndex}
              // mousedown, not click: the input must not lose focus first.
              onMouseDown={(e) => {
                e.preventDefault();
                acceptSuggestion(cmd);
              }}
              className={cn(
                'flex items-baseline gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-accent/60',
                i === suggestionIndex && 'bg-accent text-accent-foreground'
              )}
            >
              <span className="font-mono shrink-0">{cmd.syntax}</span>
              <span className="text-muted-foreground truncate">{cmd.description}</span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2 p-2 border-t border-border">
        <Input
          ref={inputRef}
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          name="console-input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setHistoryIndex(-1);
            setSuggestionIndex(null);
            setSuggestionsDismissed(false);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => setSuggestionsDismissed(true)}
          placeholder={t('repeater_console_input_placeholder')}
          aria-label={t('repeater_console_input_aria')}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
          aria-controls={showSuggestions ? SUGGESTION_LIST_ID : undefined}
          aria-activedescendant={
            showSuggestions && suggestionIndex !== null
              ? `${SUGGESTION_LIST_ID}-${suggestionIndex}`
              : undefined
          }
          disabled={loading}
          className="flex-1 font-mono text-sm"
        />
        <Button type="submit" size="sm" disabled={loading}>
          {t('common_send')}
        </Button>
      </form>
    </div>
  );
}
