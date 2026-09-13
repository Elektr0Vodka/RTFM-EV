import { useState } from 'react';
import { api } from '../../../../api';
import { useT } from '../../../../i18n';
import { Button } from '../../../ui/button';
import type { OpenHopValidateResult } from '../../../../types';

/** Read-only overview: validate the node's config and list errors/warnings. */
export function ConfigOverviewCard() {
  const t = useT();
  const [result, setResult] = useState<OpenHopValidateResult['data'] | null>(null);
  const [busy, setBusy] = useState(false);

  const validate = async () => {
    setBusy(true);
    try {
      const res = await api.validateOpenHopConfig();
      setResult(res.data ?? null);
    } catch {
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">{t('openhop_config_overview_title')}</h4>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void validate()}
        >
          {t('openhop_config_validate')}
        </Button>
      </div>
      {result && (
        <div className="text-xs">
          {result.valid ? (
            <p className="text-muted-foreground">{t('openhop_config_valid')}</p>
          ) : (
            <p className="text-destructive">
              {t('openhop_config_invalid', { count: result.errors.length })}
            </p>
          )}
          {result.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-destructive">
              {result.errors.map((e, i) => (
                <li key={i}>
                  <span className="font-mono">{e.path}</span>: {e.message}
                </li>
              ))}
            </ul>
          )}
          {result.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
              {result.warnings.map((w, i) => (
                <li key={i}>
                  <span className="font-mono">{w.path}</span>: {w.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
