import {
  BarChart3,
  Database,
  Info,
  MonitorCog,
  RadioTower,
  Share2,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import type { TFn } from '../../i18n';

export type SettingsSection =
  | 'radio'
  | 'local'
  | 'radio-app'
  | 'database'
  | 'fanout'
  | 'statistics'
  | 'about';

export const SETTINGS_SECTION_ORDER: SettingsSection[] = [
  'radio',
  'local',
  'fanout',
  'radio-app',
  'database',
  'statistics',
  'about',
];

const SETTINGS_SECTION_LABEL_KEYS: Record<SettingsSection, string> = {
  radio: 'settings_section_radio',
  local: 'settings_section_local',
  'radio-app': 'settings_section_radio_app',
  database: 'settings_section_database',
  fanout: 'settings_section_fanout',
  statistics: 'settings_section_statistics',
  about: 'settings_section_about',
};

export function settingsSectionLabel(section: SettingsSection, t: TFn): string {
  return t(SETTINGS_SECTION_LABEL_KEYS[section]);
}

export const SETTINGS_SECTION_ICONS: Record<SettingsSection, LucideIcon> = {
  radio: RadioTower,
  local: MonitorCog,
  'radio-app': SlidersHorizontal,
  database: Database,
  fanout: Share2,
  statistics: BarChart3,
  about: Info,
};
