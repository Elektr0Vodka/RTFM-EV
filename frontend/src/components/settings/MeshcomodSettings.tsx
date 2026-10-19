import { api } from '../../api';
import { BUDDY_ANCHORS } from '../../buddy/buddyAnchors';
import type { HealthStatus, MeshcomodConfigUpdate } from '../../types';
import { useMeshcomodConfig, broadcastMeshcomodConfig } from '../../hooks/useMeshcomodConfig';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import { useT } from '../../i18n';

interface Props {
  health: HealthStatus | null;
}

const FULL_CAPTURE_KINDS = [
  { bit: 1, id: 'meshcomod-full-capture-long', label: 'settings_meshcomod_full_capture_long' },
  { bit: 2, id: 'meshcomod-full-capture-bad', label: 'settings_meshcomod_full_capture_bad' },
  { bit: 4, id: 'meshcomod-full-capture-drops', label: 'settings_meshcomod_full_capture_drops' },
] as const;
const FULL_CAPTURE_DROPS = 4;

export function MeshcomodSettings({ health }: Props) {
  const t = useT();
  const isMeshcomod = health?.radio_device_info?.is_meshcomod ?? false;
  const { config: cfg, setCad } = useMeshcomodConfig(isMeshcomod);

  if (!isMeshcomod) return null;

  // CAD writes go through the shared hook. GPS writes go straight through the API
  // and are re-read so the shared cache reflects them for every consumer too.
  const save = async (update: MeshcomodConfigUpdate) => {
    await api.updateMeshcomodConfig(update);
    const next = await api.getMeshcomodConfig();
    broadcastMeshcomodConfig(next);
  };

  return (
    <div data-buddy-anchor={BUDDY_ANCHORS.meshcomod} className="space-y-4">
      <Separator />
      <h3 className="text-base font-semibold tracking-tight">{t('settings_meshcomod_heading')}</h3>

      <div className="flex items-start gap-2">
        <Checkbox
          id="meshcomod-cad-enabled"
          className="mt-0.5"
          disabled={!cfg?.cad_supported}
          checked={cfg?.cad_enabled === true}
          onCheckedChange={(checked) => setCad(checked === true)}
        />
        <div>
          <Label htmlFor="meshcomod-cad-enabled">{t('settings_meshcomod_cad_label')}</Label>
          <p className="text-xs text-muted-foreground">
            {cfg?.cad_supported
              ? t('settings_meshcomod_cad_supported_desc')
              : t('settings_meshcomod_cad_unsupported_desc')}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id="meshcomod-gps-enabled"
          className="mt-0.5"
          disabled={!cfg?.gps_supported}
          checked={cfg?.gps_enabled === true}
          onCheckedChange={(checked) => save({ gps_enabled: checked === true })}
        />
        <div className="flex-1">
          <Label htmlFor="meshcomod-gps-enabled">{t('settings_meshcomod_gps_label')}</Label>
          <p className="text-xs text-muted-foreground">
            {cfg?.gps_supported
              ? t('settings_meshcomod_gps_supported_desc')
              : t('settings_meshcomod_gps_unsupported_desc')}
          </p>
          {cfg?.gps_supported && cfg?.gps_enabled && (
            <div className="mt-2 flex items-center gap-2">
              <Label htmlFor="meshcomod-gps-interval">
                {t('settings_meshcomod_gps_interval_label')}
              </Label>
              <input
                id="meshcomod-gps-interval"
                type="number"
                min={0}
                max={86400}
                defaultValue={cfg?.gps_interval ?? 0}
                className="w-24 rounded border px-2 py-1 text-sm"
                onBlur={(e) => save({ gps_interval: Number(e.target.value) })}
              />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">{t('settings_meshcomod_full_capture_title')}</h4>
        {cfg?.full_capture_supported ? (
          <>
            <p className="text-xs text-muted-foreground">
              {t('settings_meshcomod_full_capture_hint')}
            </p>
            {FULL_CAPTURE_KINDS.map(({ bit, id, label }) => {
              const flags = cfg.full_capture_flags ?? 0;
              return (
                <div key={id} className="flex items-start gap-2">
                  <Checkbox
                    id={id}
                    className="mt-0.5"
                    checked={(flags & bit) !== 0}
                    onCheckedChange={(checked) =>
                      save({ full_capture_flags: checked === true ? flags | bit : flags & ~bit })
                    }
                  />
                  <Label htmlFor={id}>{t(label)}</Label>
                </div>
              );
            })}
            {((cfg.full_capture_flags ?? 0) & FULL_CAPTURE_DROPS) !== 0 && (
              <p className="text-xs text-muted-foreground">
                {t('settings_meshcomod_full_capture_drops_value', {
                  count: cfg.rx_ring_drops ?? 0,
                })}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t('settings_meshcomod_full_capture_unsupported')}
          </p>
        )}
      </div>
    </div>
  );
}
