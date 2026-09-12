import {
  BarChart3,
  Database,
  Info,
  Lightbulb,
  MonitorCog,
  RadioTower,
  Share2,
  ShieldAlert,
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
  | 'openhop'
  | 'statistics'
  | 'handy-info'
  | 'about';

export const SETTINGS_SECTION_ORDER: SettingsSection[] = [
  'radio',
  'local',
  'fanout',
  'openhop',
  'radio-app',
  'database',
  'statistics',
  'handy-info',
  'about',
];

const SETTINGS_SECTION_LABEL_KEYS: Record<SettingsSection, string> = {
  radio: 'settings_section_radio',
  local: 'settings_section_local',
  'radio-app': 'settings_section_radio_app',
  database: 'settings_section_database',
  fanout: 'settings_section_fanout',
  openhop: 'settings_section_openhop',
  statistics: 'settings_section_statistics',
  'handy-info': 'settings_section_handy_info',
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
  openhop: ShieldAlert,
  statistics: BarChart3,
  'handy-info': Lightbulb,
  about: Info,
};
