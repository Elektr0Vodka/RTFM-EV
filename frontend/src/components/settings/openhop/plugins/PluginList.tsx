import type { OpenHopPlugin } from '../../../../types';
import { useT } from '../../../../i18n';
import { PluginCard } from './PluginCard';

interface Props {
  plugins: OpenHopPlugin[];
  onReload: () => void;
  onOperate: (id: string) => void;
  setError: (msg: string | null) => void;
}

/** The installed plugins list. */
export function PluginList({ plugins, onReload, onOperate, setError }: Props) {
  const t = useT();
  if (plugins.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('openhop_plugins_empty')}</p>;
  }
  return (
    <div className="space-y-3">
      {plugins.map((p) => (
        <PluginCard
          key={p.id}
          plugin={p}
          onReload={onReload}
          onOperate={onOperate}
          setError={setError}
        />
      ))}
    </div>
  );
}
