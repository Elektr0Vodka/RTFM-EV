import { useState, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { TILE_LAYERS, MAP_MIN_ZOOM, MAP_MAX_ZOOM } from '../utils/mapTiles';
import { isValidLocation } from '../utils/pathUtils';
import { Button } from './ui/button';
import type { Contact } from '../types';

interface LocationPickerModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (lat: number, lon: number, label: string) => void;
  contacts: Contact[];
  /** Initial map center and default selected point. */
  initialCenter: [number, number];
  /** Prefill for the label field. */
  initialLabel?: string;
}

// Leaflet click handler: moves the selection to the tapped point.
function ClickCapture({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

export function LocationPickerModal({
  open,
  onClose,
  onConfirm,
  contacts,
  initialCenter,
  initialLabel = '',
}: LocationPickerModalProps) {
  const [selected, setSelected] = useState<[number, number]>(initialCenter);
  const [label, setLabel] = useState(initialLabel);

  const handlePick = useCallback((lat: number, lon: number) => {
    setSelected([lat, lon]);
  }, []);

  if (!open) return null;

  const baseLayer = TILE_LAYERS[0];
  const nodeMarkers = contacts.filter((c) => isValidLocation(c.lat, c.lon));

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Pick a location"
    >
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-xl">
        <h2 className="text-base font-semibold">Pick a location</h2>
        <p className="text-xs text-muted-foreground">
          Click the map to drop a pin, or click a node marker to use its location.
        </p>
        <div className="h-64 overflow-hidden rounded border border-border">
          <MapContainer
            center={initialCenter}
            zoom={13}
            minZoom={MAP_MIN_ZOOM}
            maxZoom={MAP_MAX_ZOOM}
            className="h-full w-full"
            style={{ background: baseLayer.background }}
          >
            <TileLayer
              url={baseLayer.url}
              attribution={baseLayer.attribution}
              maxZoom={baseLayer.maxZoom}
            />
            <ClickCapture onPick={handlePick} />
            {nodeMarkers.map((c) => (
              <CircleMarker
                key={c.public_key}
                center={[c.lat!, c.lon!]}
                radius={6}
                pathOptions={{
                  color: '#3b82f6',
                  fillColor: '#3b82f6',
                  fillOpacity: 0.7,
                  weight: 1,
                }}
                eventHandlers={{
                  click: () => {
                    setSelected([c.lat!, c.lon!]);
                    if (c.name) setLabel(c.name);
                  },
                }}
              />
            ))}
            <CircleMarker
              center={selected}
              radius={9}
              pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.6, weight: 3 }}
            />
          </MapContainer>
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          {selected[0].toFixed(6)}, {selected[1].toFixed(6)}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span>Label (optional)</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="e.g. Meetup point"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(selected[0], selected[1], label)}>Insert</Button>
        </div>
      </div>
    </div>
  );
}
