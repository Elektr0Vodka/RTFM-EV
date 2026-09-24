import { useState } from 'react';
import { toast } from '../../ui/sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { api } from '../../../api';
import { useT } from '../../../i18n';
import type { Contact, HostRepeaterRegion, HostRepeaterSettings } from '../../../types';
import { MAX_REGIONS, importRepeaterRegions, regionRows, selfAndDescendants } from './regionTree';

const selectClass = 'rounded border border-input bg-background px-2 py-1 text-sm';

interface Props {
  draft: HostRepeaterSettings;
  onChange: (patch: Partial<HostRepeaterSettings>) => void;
  /** Repeater contacts the region tree can be imported from. */
  repeaters: Contact[];
  /** True when the list was pre-filled from the radio's flood scopes and not saved yet. */
  prefilled: boolean;
}

/**
 * Host repeater region map (firmware RegionMap): the regions whose scoped floods
 * are forwarded, their parents (for duty-cycle region gating) and the home region.
 */
export function HostRepeaterRegions({ draft, onChange, repeaters, prefilled }: Props) {
  const t = useT();
  const [newRegion, setNewRegion] = useState('');
  const [importKey, setImportKey] = useState('');
  const [importing, setImporting] = useState(false);
  const regions = draft.regions;
  const rows = regionRows(regions);

  const setRegions = (next: HostRepeaterRegion[], home = draft.home_region) =>
    onChange({
      regions: next,
      home_region: home !== null && next.some((r) => r.name === home) ? home : null,
    });

  const patchRegion = (name: string, patch: Partial<HostRepeaterRegion>) =>
    setRegions(regions.map((r) => (r.name === name ? { ...r, ...patch } : r)));

  const removeRegion = (name: string) =>
    setRegions(
      regions
        .filter((r) => r.name !== name)
        .map((r) => (r.parent === name ? { ...r, parent: null } : r))
    );

  const newName = newRegion.trim().replace(/^#/, '');
  const canAdd =
    newName.length > 0 && regions.length < MAX_REGIONS && !regions.some((r) => r.name === newName);

  const runImport = async () => {
    const repeater = repeaters.find((c) => c.public_key === importKey);
    if (!repeater) return;
    const name = repeater.name || repeater.public_key.slice(0, 12);
    if (!window.confirm(t('settings_host_repeater_import_confirm', { name }))) return;
    setImporting(true);
    try {
      const imported = importRepeaterRegions(await api.repeaterRegions(repeater.public_key));
      if (imported.regions.length === 0 && imported.wildcardAllowed === null) {
        toast.error(t('settings_host_repeater_import_empty'));
        return;
      }
      onChange({
        regions: imported.regions,
        home_region: imported.homeRegion,
        ...(imported.wildcardAllowed !== null
          ? { unscoped_flood_allow: imported.wildcardAllowed }
          : {}),
      });
      const notes = [
        imported.anon ? t('settings_host_repeater_import_anon') : null,
        imported.truncated ? t('settings_host_repeater_import_truncated') : null,
        imported.capped ? t('settings_host_repeater_import_capped', { max: MAX_REGIONS }) : null,
      ].filter((n): n is string => n !== null);
      toast.success(
        t('settings_host_repeater_import_done', { count: imported.regions.length, name }),
        notes.length > 0 ? { description: notes.join(' ') } : undefined
      );
    } catch (err) {
      toast.error(
        t('settings_host_repeater_import_failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('settings_host_repeater_regions_desc')}</p>
      {prefilled && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t('settings_host_repeater_regions_prefilled')}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('settings_host_repeater_regions_empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pr-3">{t('settings_host_repeater_region_col_name')}</th>
                <th className="pr-3">{t('settings_host_repeater_region_col_parent')}</th>
                <th className="pr-3">{t('settings_host_repeater_region_col_flood')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ region, depth }) => {
                const invalidParents = selfAndDescendants(regions, region.name);
                return (
                  <tr key={region.name}>
                    <td className="py-0.5 pr-3 font-mono" style={{ paddingLeft: (depth - 1) * 12 }}>
                      {region.name}
                      {draft.home_region === region.name && (
                        <span className="ml-1 text-xs text-primary">
                          {t('settings_host_repeater_home_badge')}
                        </span>
                      )}
                    </td>
                    <td className="pr-3">
                      <select
                        aria-label={t('settings_host_repeater_region_parent_label', {
                          name: region.name,
                        })}
                        className={selectClass}
                        value={region.parent ?? ''}
                        onChange={(e) =>
                          patchRegion(region.name, { parent: e.target.value || null })
                        }
                      >
                        <option value="">{t('settings_host_repeater_region_parent_root')}</option>
                        {regions
                          .filter((r) => !invalidParents.has(r.name))
                          .map((r) => (
                            <option key={r.name} value={r.name}>
                              {r.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="pr-3">
                      <select
                        aria-label={t('settings_host_repeater_region_rule', { name: region.name })}
                        className={selectClass}
                        value={region.deny_flood ? 'deny' : 'allow'}
                        onChange={(e) =>
                          patchRegion(region.name, { deny_flood: e.target.value === 'deny' })
                        }
                      >
                        <option value="allow">{t('settings_host_repeater_region_allow')}</option>
                        <option value="deny">{t('settings_host_repeater_region_deny')}</option>
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-xs text-destructive underline"
                        aria-label={t('settings_host_repeater_region_remove_label', {
                          name: region.name,
                        })}
                        onClick={() => removeRegion(region.name)}
                      >
                        {t('settings_host_repeater_region_remove')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t('settings_host_repeater_region_add_placeholder')}
          placeholder={t('settings_host_repeater_region_add_placeholder')}
          value={newRegion}
          onChange={(e) => setNewRegion(e.target.value)}
          className="w-48"
        />
        <Button
          type="button"
          variant="outline"
          disabled={!canAdd}
          onClick={() => {
            setRegions([...regions, { name: newName, parent: null, deny_flood: false }]);
            setNewRegion('');
          }}
        >
          {t('settings_host_repeater_region_add')}
        </Button>
      </div>

      <div className="space-y-1">
        <Label htmlFor="hr-home">{t('settings_host_repeater_home_label')}</Label>
        <select
          id="hr-home"
          className={selectClass}
          value={draft.home_region ?? ''}
          onChange={(e) => onChange({ home_region: e.target.value || null })}
        >
          <option value="">{t('settings_host_repeater_home_none')}</option>
          {regions.map((r) => (
            <option key={r.name} value={r.name}>
              {r.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{t('settings_host_repeater_home_desc')}</p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="hr-import">{t('settings_host_repeater_import_label')}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id="hr-import"
            className={selectClass}
            value={importKey}
            onChange={(e) => setImportKey(e.target.value)}
          >
            <option value="">{t('settings_host_repeater_import_choose')}</option>
            {repeaters.map((c) => (
              <option key={c.public_key} value={c.public_key}>
                {c.name || c.public_key.slice(0, 12)}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            disabled={!importKey || importing}
            onClick={() => void runImport()}
          >
            {importing
              ? t('settings_host_repeater_import_running')
              : t('settings_host_repeater_import_button')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('settings_host_repeater_import_desc')}</p>
      </div>
    </div>
  );
}
