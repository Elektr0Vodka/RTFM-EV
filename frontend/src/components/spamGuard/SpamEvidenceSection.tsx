import { useState } from 'react';

import { api } from '../../api';
import { useT } from '../../i18n';
import type { SpamGuardReplayResult, SpamGuardSettings, SpamReplaySample } from '../../types';
import { Button } from '../ui/button';

const PERIODS = [1, 3, 7, 14, 30];
const LINK_CLASS =
  'inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground';

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('could not read the file'));
    reader.readAsText(file);
  });
}

function Samples({ title, samples }: { title: string; samples: SpamReplaySample[] }) {
  if (samples.length === 0) return null;
  return (
    <div className="space-y-1">
      <h5 className="text-[0.8125rem] font-medium text-foreground">{title}</h5>
      <ul className="space-y-0.5 text-[0.8125rem] text-muted-foreground">
        {samples.map((sample, index) => (
          <li key={`${sample.ts}-${index}`} className="break-words">
            <span className="font-medium text-foreground">{sample.sender}</span>: {sample.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Download the evidence log, or replay it against the settings in the form.
 * A replay runs on the server against a fresh detector and changes nothing.
 */
export function SpamEvidenceSection({ draft }: { draft: SpamGuardSettings }) {
  const t = useT();
  const [days, setDays] = useState(7);
  const [source, setSource] = useState<'stored' | 'file'>('stored');
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SpamGuardReplayResult | null>(null);

  const run = async () => {
    setError(null);
    if (source === 'file' && !file) {
      setError(t('spam_replay_need_file'));
      return;
    }
    setRunning(true);
    try {
      const body =
        source === 'file' && file
          ? { evidence: await readText(file), settings: draft }
          : { days, settings: draft };
      setResult(await api.replaySpamGuard(body));
    } catch (err) {
      setResult(null);
      setError(
        t('spam_replay_failed', { error: err instanceof Error ? err.message : String(err) })
      );
    } finally {
      setRunning(false);
    }
  };

  const blocks = result ? Object.values(result.blocks).reduce((sum, count) => sum + count, 0) : 0;

  return (
    <section className="space-y-3 rounded-md border border-border/60 p-3">
      <h3 className="text-sm font-semibold text-foreground">{t('spam_evidence_title')}</h3>
      <p className="text-[0.8125rem] text-muted-foreground">{t('spam_evidence_desc')}</p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="spam-evidence-days">{t('spam_evidence_days')}</label>
        <select
          id="spam-evidence-days"
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {PERIODS.map((period) => (
            <option key={period} value={period}>
              {period === 1
                ? t('spam_evidence_days_one')
                : t('spam_evidence_days_many', { count: period })}
            </option>
          ))}
        </select>
        <a className={LINK_CLASS} href={api.spamGuardEvidenceUrl(days, false)} download>
          {t('spam_evidence_download')}
        </a>
        <a className={LINK_CLASS} href={api.spamGuardEvidenceUrl(days, true)} download>
          {t('spam_evidence_download_scrambled')}
        </a>
      </div>
      <p className="text-[0.8125rem] text-muted-foreground">{t('spam_evidence_scrambled_help')}</p>

      <fieldset className="space-y-1 text-sm">
        <legend className="text-sm font-medium text-foreground">{t('spam_replay_title')}</legend>
        <div className="flex items-center gap-2">
          <input
            id="spam-replay-stored"
            type="radio"
            name="spam-replay-source"
            checked={source === 'stored'}
            onChange={() => setSource('stored')}
          />
          <label htmlFor="spam-replay-stored">{t('spam_replay_source_stored')}</label>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="spam-replay-file"
            type="radio"
            name="spam-replay-source"
            checked={source === 'file'}
            onChange={() => setSource('file')}
          />
          <label htmlFor="spam-replay-file">{t('spam_replay_source_file')}</label>
        </div>
        {source === 'file' && (
          <div className="ml-6 flex flex-wrap items-center gap-2">
            <label htmlFor="spam-replay-upload" className="text-[0.8125rem] text-muted-foreground">
              {t('spam_replay_file')}
            </label>
            <input
              id="spam-replay-upload"
              type="file"
              accept=".jsonl,.json,.txt,application/x-ndjson"
              className="text-[0.8125rem]"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={running} onClick={() => void run()}>
          {t('spam_replay_run')}
        </Button>
        {running && (
          <span className="text-[0.8125rem] text-muted-foreground" role="status">
            {t('spam_replay_running')}
          </span>
        )}
      </div>
      <p className="text-[0.8125rem] text-muted-foreground">{t('spam_replay_cold')}</p>
      {error && (
        <p className="text-[0.8125rem] text-destructive" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div
          className="space-y-2 rounded-md border border-border/60 p-3"
          data-testid="spam-replay-result"
        >
          <h4 className="text-sm font-medium text-foreground">{t('spam_replay_result_title')}</h4>
          <ul className="space-y-1 text-[0.8125rem] text-muted-foreground">
            <li>{t('spam_replay_messages', { count: result.messages })}</li>
            <li>
              {t('spam_replay_stopped', {
                stopped: result.stopped,
                recorded: result.recorded_stopped,
              })}
            </li>
            <li>{t('spam_replay_flagged', { count: result.flagged })}</li>
            <li>{t('spam_replay_blocks', { count: blocks })}</li>
            {result.labels.spam > 0 && (
              <li>
                {t('spam_replay_spam_labels', {
                  total: result.labels.spam,
                  caught: result.caught,
                  later: result.flagged_later,
                  missed: result.missed,
                })}
              </li>
            )}
            {result.labels.genuine > 0 && (
              <li>
                {t('spam_replay_genuine_labels', {
                  total: result.labels.genuine,
                  passed: result.passed,
                  held: result.wrongly_held,
                })}
              </li>
            )}
            {result.labels.spam + result.labels.genuine === 0 && (
              <li>{t('spam_replay_labels_none')}</li>
            )}
            {result.skipped > 0 && <li>{t('spam_replay_skipped', { count: result.skipped })}</li>}
            {result.scrambled && <li>{t('spam_replay_scrambled')}</li>}
          </ul>
          <Samples title={t('spam_replay_missed_title')} samples={result.missed_samples} />
          <Samples title={t('spam_replay_held_title')} samples={result.wrongly_held_samples} />
        </div>
      )}
    </section>
  );
}
