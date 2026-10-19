import { useState } from 'react';

import { useT } from '../../i18n';
import { Button } from '../../components/ui/button';
import { wardriveApi } from '../api';
import { WardriveMapView } from '../map/WardriveMapView';

/** The driver's map: what their visibility lets them see. Closed until asked
 * for, so a drive does not load MapLibre or the data. */
export function MapPanel() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('wardrive_map_heading')}</h2>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? t('wardrive_map_hide') : t('wardrive_map_show')}
        </Button>
      </div>
      {open && <WardriveMapView load={(range) => wardriveApi.data(range)} />}
    </section>
  );
}
