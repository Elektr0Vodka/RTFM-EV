import { useT } from '../../i18n';
import { ThemeSelector } from '../settings/ThemeSelector';
import { CrtEffects } from '../settings/CrtEffects';
import { BuddySettings } from '../settings/BuddySettings';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

interface ThemeSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The quick theme dialog behind the sun/moon button: theme grid, CRT effects, buddy. */
export function ThemeSettingsDialog({ open, onOpenChange }: ThemeSettingsDialogProps) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('settings_color_scheme')}</DialogTitle>
        </DialogHeader>
        <ThemeSelector />
        <CrtEffects />
        <BuddySettings compact />
      </DialogContent>
    </Dialog>
  );
}
