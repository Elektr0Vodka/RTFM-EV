import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { HealthStatus, MeshcomodConfig, MeshcomodConfigUpdate } from '../../types';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';

interface Props {
  health: HealthStatus | null;
}

export function MeshcomodSettings({ health }: Props) {
  const isMeshcomod = health?.radio_device_info?.is_meshcomod ?? false;
  const [cfg, setCfg] = useState<MeshcomodConfig | null>(null);

  useEffect(() => {
    if (!isMeshcomod) return;
    let cancelled = false;
    api
      .getMeshcomodConfig()
      .then((data) => {
        if (!cancelled) setCfg(data);
      })
      .catch((err) => console.error('Failed to load meshcomod config:', err));
    return () => {
      cancelled = true;
    };
  }, [isMeshcomod]);

  if (!isMeshcomod) return null;

  const save = async (update: MeshcomodConfigUpdate) => {
    const next = await api.updateMeshcomodConfig(update);
    setCfg(next);
  };

  return (
    <div className="space-y-4">
      <Separator />
      <h3 className="text-base font-semibold tracking-tight">Meshcomod (DMC-EV)</h3>

      <div className="flex items-start gap-2">
        <Checkbox
          id="meshcomod-cad-enabled"
          className="mt-0.5"
          disabled={!cfg?.cad_supported}
          checked={cfg?.cad_enabled === true}
          onCheckedChange={(checked) => save({ cad_enabled: checked === true })}
        />
        <div>
          <Label htmlFor="meshcomod-cad-enabled">CAD (Channel Activity Detection)</Label>
          <p className="text-xs text-muted-foreground">
            {cfg?.cad_supported
              ? 'Scan for channel activity before each transmit and defer if the channel is busy.'
              : 'Requires CAD-capable meshcomod firmware.'}
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
          <Label htmlFor="meshcomod-gps-enabled">GPS</Label>
          <p className="text-xs text-muted-foreground">
            {cfg?.gps_supported
              ? 'Enable the on-board GPS receiver.'
              : 'This firmware build has no GPS support.'}
          </p>
          {cfg?.gps_supported && cfg?.gps_enabled && (
            <div className="mt-2 flex items-center gap-2">
              <Label htmlFor="meshcomod-gps-interval">Interval (seconds)</Label>
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
    </div>
  );
}
