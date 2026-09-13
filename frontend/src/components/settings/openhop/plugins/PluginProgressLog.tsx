import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../api';
import type { OpenHopPluginProgressEvent } from '../../../../types';
import { useT } from '../../../../i18n';

interface Props {
  /** Plugin id whose install/update progress to stream. */
  id: string;
  /** Called once the stream reaches a terminal state (done/error/closed). */
  onDone: () => void;
}

/**
 * Streams OpenHop's plugin install/update progress via EventSource and renders
 * the log lines inline. Closes the stream and calls onDone on the terminal event.
 */
export function PluginProgressLog({ id, onDone }: Props) {
  const t = useT();
  const [lines, setLines] = useState<string[]>([]);
  const [state, setState] = useState<string>('running');
  const [finished, setFinished] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const es = new EventSource(api.openHopPluginProgressUrl(id));
    const finish = (nextState: string) => {
      setState(nextState);
      setFinished(true);
      es.close();
      doneRef.current();
    };
    es.onmessage = (ev: MessageEvent) => {
      let evt: OpenHopPluginProgressEvent;
      try {
        evt = JSON.parse(ev.data) as OpenHopPluginProgressEvent;
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
  }, [id]);

  const label = finished
    ? state === 'complete'
      ? t('openhop_progress_done')
      : state === 'stream_ended'
        ? t('openhop_progress_stream_ended')
        : t('openhop_progress_error')
    : t('openhop_progress_installing');

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
