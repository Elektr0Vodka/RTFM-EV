import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { useT } from '../../i18n';
import { ThemeSelector } from '../settings/ThemeSelector';
import { CrtEffects } from '../settings/CrtEffects';
import { BuddySettings } from '../settings/BuddySettings';
import { AccessibilitySettings } from '../settings/AccessibilitySettings';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { BUDDY_PREFS_CHANGE_EVENT, isBuddyAvailable } from '../../buddy/buddyPrefs';
import { THEME_CHANGE_EVENT } from '../../utils/theme';
import { cn } from '@/lib/utils';
import {
  getOpenThemeDialogSections,
  saveOpenThemeDialogSections,
  type ThemeDialogSection,
} from '../../utils/themeDialogSections';

interface ThemeSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** A collapsible block of the dialog; the body only mounts while open. */
function DialogSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <div className="border-t border-border/60 first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className="flex w-full items-center gap-2 py-2.5 text-left text-sm font-medium hover:text-foreground/80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-90')}
        />
        {title}
      </button>
      {open && (
        <div id={bodyId} className="pb-3 [&>section]:mt-0">
          {children}
        </div>
      )}
    </div>
  );
}

/** The quick theme dialog behind the sun/moon button: theme grid, CRT effects,
 *  accessibility (colourblind mode, reading font), buddy. Every section starts
 *  collapsed; the ones the user opens are remembered per browser. */
export function ThemeSettingsDialog({ open, onOpenChange }: ThemeSettingsDialogProps) {
  const t = useT();
  const [openSections, setOpenSections] = useState<ThemeDialogSection[]>(
    getOpenThemeDialogSections
  );
  const [buddyAvailable, setBuddyAvailable] = useState(() => isBuddyAvailable());

  useEffect(() => {
    const sync = () => setBuddyAvailable(isBuddyAvailable());
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener(BUDDY_PREFS_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener(BUDDY_PREFS_CHANGE_EVENT, sync);
    };
  }, []);

  const toggle = (section: ThemeDialogSection) => {
    setOpenSections((prev) => {
      const next = prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section];
      saveOpenThemeDialogSections(next);
      return next;
    });
  };
  const sectionProps = (section: ThemeDialogSection) => ({
    open: openSections.includes(section),
    onToggle: () => toggle(section),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('settings_color_scheme')}</DialogTitle>
        </DialogHeader>
        <div>
          <DialogSection title={t('settings_theme_legend')} {...sectionProps('theme')}>
            <ThemeSelector />
          </DialogSection>
          <DialogSection title={t('settings_crt_effects_legend')} {...sectionProps('crt')}>
            <CrtEffects />
          </DialogSection>
          <DialogSection
            title={t('settings_accessibility_heading')}
            {...sectionProps('accessibility')}
          >
            <AccessibilitySettings compact />
          </DialogSection>
          {buddyAvailable && (
            <DialogSection title={t('settings_buddy_label')} {...sectionProps('buddy')}>
              <BuddySettings compact />
            </DialogSection>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
