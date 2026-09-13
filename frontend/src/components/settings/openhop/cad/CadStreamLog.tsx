import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../api';
import { useT } from '../../../../i18n';

interface Props {
  /** Called when the stream reaches a terminal state (done/error/closed). */
  onDone: () => void;
}

interface StreamEvent {
  type?: string;
  line?: string;
  state?: string;
  [k: string]: unknown;
}

/**
 * Streams OpenHop's CAD calibration SSE and renders each event as a log line.
 * Closes and calls onDone on the terminal event.
 */
export function CadStreamLog({ onDone }: Props) {
  const t = useT();
  const [lines, setLines] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const es = new EventSource(api.openHopCadStreamUrl());
    const finish = () => {
      setFinished(true);
      es.close();
      doneRef.current();
    };
    es.onmessage = (ev: MessageEvent) => {
      let evt: StreamEvent;
      try {
        evt = JSON.parse(ev.data) as StreamEvent;
      } catch {
        return;
      }
      if (evt.type === 'done') {
        finish();
        return;
      }
      if (evt.type === 'keepalive') return;
      setLines((prev) => [...prev, evt.line ?? ev.data]);
    };
    es.onerror = () => finish();
    return () => es.close();
  }, []);

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/40 p-2">
      <div className="mb-1 text-xs text-muted-foreground">
        {finished ? t('openhop_progress_done') : t('openhop_cad_streaming')}
      </div>
      {lines.length > 0 && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-foreground">
          {lines.join('\n')}
        </pre>
      )}
    </div>
  );
}
