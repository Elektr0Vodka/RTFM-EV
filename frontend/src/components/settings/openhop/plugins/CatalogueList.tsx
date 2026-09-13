import type { OpenHopCatalogueEntry } from '../../../../types';
import { useT } from '../../../../i18n';
import { Button } from '../../../ui/button';
import { CatalogueCard } from './CatalogueCard';

interface Props {
  entries: OpenHopCatalogueEntry[];
  onOperate: (id: string) => void;
  onRefresh: () => void;
}

/** The curated plugin catalogue. */
export function CatalogueList({ entries, onOperate, onRefresh }: Props) {
  const t = useT();
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={onRefresh}>
          {t('openhop_catalogue_refresh')}
        </Button>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('openhop_catalogue_empty')}</p>
      ) : (
        entries.map((e) => <CatalogueCard key={e.id} entry={e} onOperate={onOperate} />)
      )}
    </div>
  );
}
