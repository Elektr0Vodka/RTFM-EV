import {
  Database,
  Info,
  Lightbulb,
  MapPin,
  MonitorCog,
  RadioTower,
  Repeat,
  Share2,
  ShieldAlert,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import type { TFn } from '../../i18n';

export type SettingsSection =
  | 'radio'
  | 'host-repeater'
  | 'local'
  | 'radio-app'
  | 'map'
  | 'database'
  | 'fanout'
  | 'openhop'
  | 'handy-info'
  | 'about';

export const SETTINGS_SECTION_ORDER: SettingsSection[] = [
  'radio',
  'host-repeater',
  'local',
  'fanout',
  'openhop',
  'radio-app',
  'map',
  'database',
  'handy-info',
  'about',
];

const SETTINGS_SECTION_LABEL_KEYS: Record<SettingsSection, string> = {
  radio: 'settings_section_radio',
  'host-repeater': 'settings_section_host_repeater',
  local: 'settings_section_local',
  'radio-app': 'settings_section_radio_app',
  map: 'settings_section_map',
  database: 'settings_section_database',
  fanout: 'settings_section_fanout',
  openhop: 'settings_section_openhop',
  'handy-info': 'settings_section_handy_info',
  about: 'settings_section_about',
};

export function settingsSectionLabel(section: SettingsSection, t: TFn): string {
  return t(SETTINGS_SECTION_LABEL_KEYS[section]);
}

export const SETTINGS_SECTION_ICONS: Record<SettingsSection, LucideIcon> = {
  radio: RadioTower,
  'host-repeater': Repeat,
  local: MonitorCog,
  'radio-app': SlidersHorizontal,
  map: MapPin,
  database: Database,
  fanout: Share2,
  openhop: ShieldAlert,
  'handy-info': Lightbulb,
  about: Info,
};
