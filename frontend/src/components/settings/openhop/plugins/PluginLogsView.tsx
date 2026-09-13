import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../api';
import { useT } from '../../../../i18n';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';

interface Props {
  id: string;
}

/** Tail viewer for a plugin's log output. */
export function PluginLogsView({ id }: Props) {
  const t = useT();
  const [tail, setTail] = useState(200);
  const [lines, setLines] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getOpenHopPluginLogs(id, tail);
      const out = res.lines ?? (res.log ? res.log.split('\n') : []);
      setLines(out);
    } catch {
      setLines([]);
    } finally {
      setLoaded(true);
    }
  }, [id, tail]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground" htmlFor={`tail-${id}`}>
          {t('openhop_plugin_logs_tail')}
        </label>
        <Input
          id={`tail-${id}`}
          type="number"
          value={tail}
          onChange={(e) => setTail(Number(e.target.value) || 200)}
          className="h-8 w-24"
        />
        <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
          {t('openhop_plugin_logs_refresh')}
        </Button>
      </div>
      {loaded && lines.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('openhop_plugin_logs_empty')}</p>
      ) : (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-snug">
          {lines.join('\n')}
        </pre>
      )}
    </div>
  );
}
