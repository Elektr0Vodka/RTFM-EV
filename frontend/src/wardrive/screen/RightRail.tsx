// The round buttons at the right edge, above the HUD (rx's rail): the map view
// (five modes), the compass (static, follow north up, follow heading), sound,
// and the node positions layer. Each button's name says its current state.
import {
  Box,
  Compass,
  LocateFixed,
  LocateOff,
  MapPin,
  Radar,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { useT } from '../../i18n';
import type { AutoDiscoverState } from '../discover/useAutoDiscover';
import type { CompassMode } from '../map/compassMode';
import type { NodePosMode } from '../map/nodeLayer';
import { viewKey, type ViewState } from '../map/viewModes';
import type { SoundMode } from '../useWardriveSound';

export interface RightRailProps {
  view: ViewState;
  onView(): void;
  compass: CompassMode;
  onCompass(): void;
  sound: SoundMode;
  onSound(): void;
  nodePos: NodePosMode;
  onNodePos(): void;
  /** The one transmitting switch: off at every start. */
  autoDiscover: AutoDiscoverState;
  autoDiscoverDisabled: boolean;
  onAutoDiscover(): void;
  /** Bumped on every frame sent: the button pulses. */
  autoDiscoverPulse?: number;
}

function RoundButton({
  label,
  pressed,
  onClick,
  disabled = false,
  pulse,
  children,
}: {
  label: string;
  pressed: boolean;
  onClick(): void;
  disabled?: boolean;
  pulse?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className={`relative flex h-11 w-11 items-center justify-center rounded-full border shadow-md backdrop-blur disabled:opacity-40 ${
        pressed
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card/90 text-foreground'
      }`}
    >
      {pulse ? (
        <span
          key={pulse}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-primary motion-safe:animate-[ping_0.6s_ease-out_1]"
        />
      ) : null}
      {children}
    </button>
  );
}

export function RightRail({
  view,
  onView,
  compass,
  onCompass,
  sound,
  onSound,
  nodePos,
  onNodePos,
  autoDiscover,
  autoDiscoverDisabled,
  onAutoDiscover,
  autoDiscoverPulse,
}: RightRailProps) {
  const t = useT();
  const key = viewKey(view);
  return (
    <nav className="flex flex-col gap-2">
      <RoundButton
        label={t('wardrive_page_rail_view', { state: t(`wardrive_page_view_${key}`) })}
        pressed={view.mode3D}
        onClick={onView}
      >
        <span className="flex flex-col items-center leading-none" aria-hidden="true">
          <Box className="h-4 w-4" />
          <span className="text-[9px] font-semibold">{view.mode3D ? '3D' : '2D'}</span>
        </span>
      </RoundButton>
      <RoundButton
        label={t(`wardrive_page_rail_autodiscover_${autoDiscover}`)}
        pressed={autoDiscover !== 'off'}
        onClick={onAutoDiscover}
        disabled={autoDiscoverDisabled}
        pulse={autoDiscoverPulse}
      >
        <Radar className="h-5 w-5" aria-hidden="true" />
      </RoundButton>
      <RoundButton
        label={t('wardrive_page_rail_compass', { state: t(`wardrive_page_compass_${compass}`) })}
        pressed={compass !== 'static'}
        onClick={onCompass}
      >
        {compass === 'heading' ? (
          <Compass className="h-5 w-5" aria-hidden="true" />
        ) : compass === 'north' ? (
          <LocateFixed className="h-5 w-5" aria-hidden="true" />
        ) : (
          <LocateOff className="h-5 w-5" aria-hidden="true" />
        )}
      </RoundButton>
      <RoundButton label={t('wardrive_page_rail_sound')} pressed={sound === 'rx'} onClick={onSound}>
        {sound === 'rx' ? (
          <Volume2 className="h-5 w-5" aria-hidden="true" />
        ) : (
          <VolumeX className="h-5 w-5" aria-hidden="true" />
        )}
      </RoundButton>
      <RoundButton
        label={t('wardrive_page_rail_nodepos', { state: t(`wardrive_page_nodepos_${nodePos}`) })}
        pressed={nodePos !== 'off'}
        onClick={onNodePos}
      >
        <MapPin className="h-5 w-5" aria-hidden="true" />
      </RoundButton>
    </nav>
  );
}
