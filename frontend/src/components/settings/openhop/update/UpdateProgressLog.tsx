import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../api';
import type { OpenHopUpdateEvent } from '../../../../types';
import { useT } from '../../../../i18n';

interface Props {
  /** Called once the stream reaches a terminal state (done/error/closed). */
  onDone: () => void;
}

/**
 * Streams OpenHop's OTA install progress via EventSource and renders the log
 * lines inline. Closes the stream and calls onDone on the terminal event.
 */
export function UpdateProgressLog({ onDone }: Props) {
  const t = useT();
  const [lines, setLines] = useState<string[]>([]);
  const [state, setState] = useState<string>('running');
  const [finished, setFinished] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const es = new EventSource(api.openHopUpdateProgressUrl());
    const finish = (nextState: string) => {
      setState(nextState);
      setFinished(true);
      es.close();
      doneRef.current();
    };
    es.onmessage = (ev: MessageEvent) => {
      let evt: OpenHopUpdateEvent;
      try {
        evt = JSON.parse(ev.data) as OpenHopUpdateEvent;
      } catch {
        return;
      }
      if (evt.type === 'line') {
        setLines((prev) => [...prev, evt.line]);
      } else if (evt.type === 'status') {
        setState(evt.state);
      } else if (evt.type === 'done') {
        finish(evt.state);
      }
    };
    es.onerror = () => finish('stream_ended');
    return () => es.close();
  }, []);

  const label = finished
    ? state === 'complete'
      ? t('openhop_progress_done')
      : t('openhop_progress_error')
    : t('openhop_update_installing');

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/40 p-2">
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      {lines.length > 0 && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-foreground">
          {lines.join('\n')}
        </pre>
      )}
    </div>
  );
}
