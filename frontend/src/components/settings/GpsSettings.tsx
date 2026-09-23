import { useGpsConfig } from '../../hooks/useGpsConfig';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import { useT } from '../../i18n';
import type { HealthStatus } from '../../types';

interface Props {
  health: HealthStatus | null;
}

/**
 * Generic GPS on/off toggle for any radio that reports the `gps` custom var
 * (CMD_GET_CUSTOM_VARS / CMD_SET_CUSTOM_VAR), not only the meshcomod
 * DMC/DMC-EV fork. Stock MeshCore companion firmware exposes this var too
 * when built with GPS support and a GPS module is detected.
 *
 * Meshcomod radios already show a GPS toggle in MeshcomodSettings (bundled
 * with the CAD control there), so this component stays hidden for them to
 * avoid showing the same toggle twice.
 */
export function GpsSettings({ health }: Props) {
  const t = useT();
  const isMeshcomod = health?.radio_device_info?.is_meshcomod ?? false;
  const isConnected = health?.radio_connected ?? false;
  const { config: cfg, setGps } = useGpsConfig(isConnected && !isMeshcomod);

  if (isMeshcomod) return null;
  if (!cfg?.gps_supported) return null;

  return (
    <div className="space-y-4">
      <Separator />
      <h3 className="text-base font-semibold tracking-tight">{t('settings_gps_heading')}</h3>

      <div className="flex items-start gap-2">
        <Checkbox
          id="gps-enabled"
          className="mt-0.5"
          checked={cfg.gps_enabled === true}
          onCheckedChange={(checked) => setGps({ gps_enabled: checked === true })}
        />
        <div className="flex-1">
          <Label htmlFor="gps-enabled">{t('settings_gps_enabled_label')}</Label>
          <p className="text-xs text-muted-foreground">{t('settings_gps_enabled_desc')}</p>
          {cfg.gps_enabled && (
            <div className="mt-2 flex items-center gap-2">
              <Label htmlFor="gps-interval">{t('settings_gps_interval_label')}</Label>
              <input
                id="gps-interval"
                type="number"
                min={0}
                max={86400}
                defaultValue={cfg.gps_interval ?? 0}
                className="w-24 rounded border px-2 py-1 text-sm"
                onBlur={(e) => setGps({ gps_interval: Number(e.target.value) })}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
