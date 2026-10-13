import type { TFn } from '../i18n';
import type { BotForwardStatus } from '../types';

/**
 * One line for what Block forwards is doing: "Active on N channels", or why
 * it waits. The server decides the state (`SpamGuardRuntime.bot_forward`).
 */
export function botForwardStatusText(t: TFn, forward: BotForwardStatus): string {
  switch (forward.state) {
    case 'active':
      return t('bot_forward_active', { count: forward.channels });
    case 'off':
      return t('bot_forward_off');
    case 'monitor':
      return t('bot_forward_monitor');
    case 'paused':
      return t('bot_forward_paused');
    case 'no_names':
      return t('bot_forward_no_names');
    case 'no_channels':
      return t('bot_forward_no_channels');
    case 'not_armed':
      return t('bot_forward_not_armed');
    case 'not_synced':
      return t('bot_forward_not_synced');
  }
}
