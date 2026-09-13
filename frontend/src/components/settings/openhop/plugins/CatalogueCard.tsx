import { api } from '../../../../api';
import type { OpenHopCatalogueEntry } from '../../../../types';
import { useT } from '../../../../i18n';
import { Button } from '../../../ui/button';

interface Props {
  entry: OpenHopCatalogueEntry;
  onOperate: (id: string) => void;
}

/** One curated catalogue entry with an install action. */
export function CatalogueCard({ entry, onOperate }: Props) {
  const t = useT();

  const install = () => {
    void api.installOpenHopCataloguePlugin(entry.id, entry.version);
    onOperate(entry.id);
  };

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{entry.name || entry.id}</div>
          {entry.description && (
            <p className="text-xs text-muted-foreground">{entry.description}</p>
          )}
          <div className="mt-0.5 text-xs text-muted-foreground">
            {entry.id}
            {entry.version ? ` · v${entry.version}` : ''}
            {entry.category ? ` · ${entry.category}` : ''}
          </div>
        </div>
        {entry.installed ? (
          <span className="text-xs text-muted-foreground">{t('openhop_catalogue_installed')}</span>
        ) : (
          <Button type="button" size="sm" onClick={install}>
            {t('openhop_catalogue_install')}
          </Button>
        )}
      </div>
    </div>
  );
}
