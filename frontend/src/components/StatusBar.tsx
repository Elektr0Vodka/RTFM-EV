import { useEffect, useMemo, useState } from 'react';
import {
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Menu,
  MessagesSquare,
  Moon,
  Sun,
} from 'lucide-react';
import type { HealthStatus, RadioConfig } from '../types';
import { api } from '../api';
import { toast } from './ui/sonner';
import { handleKeyboardActivate } from '../utils/a11y';
import { useT } from '../i18n';
import { getEffectiveTheme, THEME_CHANGE_EVENT } from '../utils/theme';
import { HeaderLanguageMenu } from './HeaderLanguageMenu';
import { LivePacketSparkline } from './LivePacketSparkline';
import { useUpdateStatus } from '../hooks/useUpdateStatus';
import { useHostRepeaterArmed } from '../hooks/useHostRepeaterArmed';
import { AppBrand } from './shell/AppBrand';
import { ThemeSettingsDialog } from './shell/ThemeSettingsDialog';
import { BUDDY_ANCHORS } from '../buddy/buddyAnchors';
import {
  BATTERY_DISPLAY_CHANGE_EVENT,
  getShowBatteryPercent,
  getShowBatteryVoltage,
  mvToPercent,
} from '../utils/batteryDisplay';
import {
  STATUS_DOT_PULSE_CHANGE_EVENT,
  STATUS_DOT_PULSE_DURATION_MS,
  STATUS_DOT_PULSE_PACKET_EVENT,
  getStatusDotPulseEnabled,
  pulseColorFor,
  type StatusDotPulseKind,
} from '../utils/statusDotPulse';
import { cn } from '@/lib/utils';

interface StatusBarProps {
  health: HealthStatus | null;
  config: RadioConfig | null;
  settingsMode?: boolean;
  onSettingsClick: () => void;
  onMenuClick?: () => void;
  /** Open the chat-only popup window. The button is hidden when omitted. */
  onOpenChatWindow?: () => void;
  brandName?: string;
  brandHidden?: boolean;
  brandIcon?: string;
  /**
   * 'topbar' is the Atlas layout's bar inside the content column: radio state
   * only. The brand and the settings, chat window, language and theme controls
   * live in the sidebar there (see shell/AtlasSidebar).
   */
  variant?: 'bar' | 'topbar';
  /**
   * Open the theme dialog owned by the parent. Without it the bar keeps its own
   * dialog. The shell owns it so the dialog survives a theme pick that changes
   * the layout, which moves this bar to another place in the tree.
   */
  onOpenThemeSettings?: () => void;
}

export function StatusBar({
  health,
  config,
  settingsMode = false,
  onSettingsClick,
  onMenuClick,
  onOpenChatWindow,
  brandName,
  brandHidden = false,
  brandIcon,
  variant = 'bar',
  onOpenThemeSettings,
}: StatusBarProps) {
  const topbar = variant === 'topbar';
  const t = useT();
  const { status: updateStatus } = useUpdateStatus();
  const repeaterArmed = useHostRepeaterArmed();
  const [showBatteryPercent, setShowBatteryPercent] = useState(getShowBatteryPercent);
  const [showBatteryVoltage, setShowBatteryVoltage] = useState(getShowBatteryVoltage);

  useEffect(() => {
    const handler = () => {
      setShowBatteryPercent(getShowBatteryPercent());
      setShowBatteryVoltage(getShowBatteryVoltage());
    };
    window.addEventListener(BATTERY_DISPLAY_CHANGE_EVENT, handler);
    return () => window.removeEventListener(BATTERY_DISPLAY_CHANGE_EVENT, handler);
  }, []);

  const batteryMv = health?.radio_stats?.battery_mv;
  const batteryInfo = useMemo(() => {
    if ((!showBatteryPercent && !showBatteryVoltage) || !batteryMv || batteryMv <= 0) return null;
    const pct = mvToPercent(batteryMv);
    const Icon =
      pct >= 80 ? BatteryFull : pct >= 40 ? BatteryMedium : pct >= 15 ? BatteryLow : BatteryWarning;
    const color =
      pct >= 40 ? 'text-status-connected' : pct >= 15 ? 'text-warning' : 'text-destructive';
    const label =
      showBatteryPercent && showBatteryVoltage
        ? t('status_battery_percent_and_mv', { pct, mv: batteryMv })
        : showBatteryPercent
          ? t('status_battery_percent', { pct })
          : t('status_battery_mv', { mv: batteryMv });
    return { pct, Icon, color, label, mv: batteryMv };
  }, [batteryMv, showBatteryPercent, showBatteryVoltage, t]);

  const radioState =
    health?.radio_state ??
    (health?.radio_initializing
      ? 'initializing'
      : health?.radio_connected
        ? 'connected'
        : 'disconnected');
  const connected = health?.radio_connected ?? false;
  const statusLabel =
    radioState === 'paused'
      ? t('status_radio_paused')
      : radioState === 'connecting'
        ? t('status_radio_connecting')
        : radioState === 'initializing'
          ? t('status_radio_initializing')
          : connected
            ? t('status_radio_ok')
            : t('status_radio_disconnected');
  const [reconnecting, setReconnecting] = useState(false);
  // Track the *effective* theme (follow-os is resolved to original/light) so the
  // header icon matches what the user currently sees rendered.
  const [currentTheme, setCurrentTheme] = useState(getEffectiveTheme);
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [pulseEnabled, setPulseEnabled] = useState(getStatusDotPulseEnabled);
  const [pulseKind, setPulseKind] = useState<StatusDotPulseKind | null>(null);

  useEffect(() => {
    const handler = () => setPulseEnabled(getStatusDotPulseEnabled());
    window.addEventListener(STATUS_DOT_PULSE_CHANGE_EVENT, handler);
    return () => window.removeEventListener(STATUS_DOT_PULSE_CHANGE_EVENT, handler);
  }, []);

  useEffect(() => {
    if (!pulseEnabled) {
      setPulseKind(null);
      return;
    }
    let timer: number | null = null;
    const handler = (event: Event) => {
      const kind = (event as CustomEvent<StatusDotPulseKind>).detail;
      setPulseKind(kind);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        setPulseKind(null);
        timer = null;
      }, STATUS_DOT_PULSE_DURATION_MS);
    };
    window.addEventListener(STATUS_DOT_PULSE_PACKET_EVENT, handler);
    return () => {
      window.removeEventListener(STATUS_DOT_PULSE_PACKET_EVENT, handler);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [pulseEnabled]);

  useEffect(() => {
    const syncEffective = () => setCurrentTheme(getEffectiveTheme());
    window.addEventListener(THEME_CHANGE_EVENT, syncEffective);

    // When saved theme is "follow-os", OS appearance changes alter the effective
    // theme without firing a THEME_CHANGE_EVENT, so also watch matchMedia.
    const mql =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: light)')
        : null;
    if (mql) {
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', syncEffective);
      } else if (typeof (mql as MediaQueryList).addListener === 'function') {
        (mql as MediaQueryList).addListener(syncEffective);
      }
    }

    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, syncEffective);
      if (mql) {
        if (typeof mql.removeEventListener === 'function') {
          mql.removeEventListener('change', syncEffective);
        } else if (typeof (mql as MediaQueryList).removeListener === 'function') {
          (mql as MediaQueryList).removeListener(syncEffective);
        }
      }
    };
  }, []);

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      const result = await api.reconnectRadio();
      if (result.connected) {
        toast.success(t('toast_reconnected'), { description: result.message });
      }
    } catch (err) {
      toast.error(t('toast_reconnection_failed'), {
        description: err instanceof Error ? err.message : t('toast_check_radio_connection'),
      });
    } finally {
      setReconnecting(false);
    }
  };

  return (
    <header
      className={cn(
        'app-statusbar flex items-center gap-3 text-xs',
        topbar ? 'app-topbar h-14 px-6' : 'px-4 py-2.5 bg-card border-b border-border'
      )}
    >
      {/* Mobile menu button - only visible on small screens */}
      {!topbar && onMenuClick && (
        <button
          onClick={onMenuClick}
          className="md:hidden p-0.5 bg-transparent border-none text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
          aria-label={t('a11y_open_menu')}
        >
          <Menu className="h-4 w-4" />
        </button>
      )}

      {!topbar && (
        <h1 className="text-base font-semibold tracking-tight mr-auto text-foreground flex items-center gap-1.5">
          <AppBrand brandName={brandName} brandHidden={brandHidden} brandIcon={brandIcon} />
        </h1>
      )}

      <LivePacketSparkline
        className={cn('hidden lg:flex items-center gap-1.5', topbar && 'mr-auto')}
      />
      {/* Below lg the sparkline is hidden, so this keeps the rest to the right. */}
      {topbar && <span className="mr-auto lg:hidden" aria-hidden="true" />}

      <div
        className={cn(
          'flex items-center gap-1.5',
          topbar && 'h-8 rounded-full border border-border bg-card px-3'
        )}
        role="status"
        aria-label={statusLabel}
        data-buddy-anchor={BUDDY_ANCHORS.radio}
      >
        <div
          className={cn(
            'w-2 h-2 rounded-full transition-colors',
            radioState === 'initializing' || radioState === 'connecting'
              ? 'bg-warning'
              : connected
                ? pulseKind
                  ? ''
                  : 'bg-status-connected shadow-[0_0_6px_hsl(var(--status-connected)/0.5)]'
                : 'bg-status-disconnected'
          )}
          style={connected && pulseKind ? { backgroundColor: pulseColorFor(pulseKind) } : undefined}
          aria-hidden="true"
        />
        <span className={cn('text-muted-foreground', !topbar && 'hidden lg:inline')}>
          {statusLabel}
        </span>
      </div>

      {repeaterArmed && (
        <span
          className="rounded border border-destructive/50 bg-destructive/15 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-destructive"
          role="status"
          title={t('status_host_repeater_armed_title')}
        >
          {t('status_host_repeater_armed')}
        </span>
      )}

      {connected && batteryInfo && (
        <div
          className={cn('flex items-center gap-1', batteryInfo.color)}
          title={t('status_battery_title', {
            pct: batteryInfo.pct,
            voltage: (batteryInfo.mv / 1000).toFixed(2),
          })}
          role="status"
          aria-label={t('a11y_battery_percent', { pct: batteryInfo.pct })}
          data-buddy-anchor={BUDDY_ANCHORS.battery}
        >
          <batteryInfo.Icon className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline text-[0.6875rem]">{batteryInfo.label}</span>
        </div>
      )}

      {config && (
        <div className="hidden lg:flex items-center gap-2 text-muted-foreground">
          <span className="text-foreground font-medium">{config.name || t('common_unnamed')}</span>
          <span
            className="font-mono text-[0.6875rem] text-muted-foreground cursor-pointer hover:text-primary transition-colors"
            role="button"
            tabIndex={0}
            onKeyDown={handleKeyboardActivate}
            onClick={() => {
              navigator.clipboard.writeText(config.public_key);
              toast.success(t('toast_public_key_copied'));
            }}
            title={config.public_key.toLowerCase()}
            aria-label={t('a11y_copy_public_key')}
          >
            {config.public_key.toLowerCase().slice(0, (config.path_hash_mode + 1) * 2)}
          </span>
        </div>
      )}

      {(radioState === 'disconnected' || radioState === 'paused') && (
        <button
          onClick={handleReconnect}
          disabled={reconnecting}
          className="px-3 py-1 bg-warning/10 border border-warning/20 text-warning rounded-md text-xs cursor-pointer hover:bg-warning/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {reconnecting
            ? t('status_reconnecting')
            : radioState === 'paused'
              ? t('common_connect')
              : t('common_reconnect')}
        </button>
      )}
      {!topbar && (
        <>
          {onOpenChatWindow && (
            <button
              type="button"
              onClick={onOpenChatWindow}
              className="p-0.5 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              title={t('popout_open_chat_window_title')}
              aria-label={t('popout_open_chat_window')}
            >
              <MessagesSquare className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button
            onClick={onSettingsClick}
            data-buddy-anchor={BUDDY_ANCHORS.update}
            className={cn(
              'relative px-3 py-1.5 rounded-md text-xs cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              settingsMode
                ? 'bg-status-connected/15 border border-status-connected/30 text-status-connected hover:bg-status-connected/25'
                : 'bg-secondary border border-border text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            {settingsMode ? t('nav_back_to_chat') : t('nav_settings_heading')}
            {updateStatus?.update_available ? (
              <span
                aria-label={t('a11y_update_available')}
                className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary"
              />
            ) : null}
          </button>
          <HeaderLanguageMenu />
          <button
            onClick={onOpenThemeSettings ?? (() => setThemeModalOpen(true))}
            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            title={t('a11y_open_theme_settings')}
            aria-label={t('a11y_open_theme_settings')}
          >
            {currentTheme === 'light' ? (
              <Moon className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Sun className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
          {!onOpenThemeSettings && (
            <ThemeSettingsDialog open={themeModalOpen} onOpenChange={setThemeModalOpen} />
          )}
        </>
      )}
    </header>
  );
}
