// The round buttons at the right edge, above the HUD: 3D view, follow my
// position (north up), and sound.
import { Box, LocateFixed, Volume2, VolumeX } from 'lucide-react';
import type { ReactNode } from 'react';

import { useT } from '../../i18n';
import type { SoundMode } from '../useWardriveSound';

export interface RightRailProps {
  tilt3D: boolean;
  onTilt(): void;
  follow: boolean;
  onFollow(): void;
  sound: SoundMode;
  onSound(): void;
}

function RoundButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`flex h-11 w-11 items-center justify-center rounded-full border shadow-md backdrop-blur ${
        pressed
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card/90 text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

export function RightRail({ tilt3D, onTilt, follow, onFollow, sound, onSound }: RightRailProps) {
  const t = useT();
  return (
    <nav className="flex flex-col gap-2">
      <RoundButton label={t('wardrive_page_rail_3d')} pressed={tilt3D} onClick={onTilt}>
        <Box className="h-5 w-5" aria-hidden="true" />
      </RoundButton>
      <RoundButton label={t('wardrive_page_rail_follow')} pressed={follow} onClick={onFollow}>
        <LocateFixed className="h-5 w-5" aria-hidden="true" />
      </RoundButton>
      <RoundButton label={t('wardrive_page_rail_sound')} pressed={sound === 'rx'} onClick={onSound}>
        {sound === 'rx' ? (
          <Volume2 className="h-5 w-5" aria-hidden="true" />
        ) : (
          <VolumeX className="h-5 w-5" aria-hidden="true" />
        )}
      </RoundButton>
    </nav>
  );
}
