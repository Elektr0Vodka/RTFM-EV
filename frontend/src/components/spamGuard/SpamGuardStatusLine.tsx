import { useSpamGuard } from '../../hooks/useSpamGuard';
import { useT } from '../../i18n';

/**
 * One line in the host repeater and OpenHop settings saying what Spam Guard is
 * doing to forwarding there. Renders nothing while Spam Guard is switched off.
 */
export function SpamGuardStatusLine() {
  const t = useT();
  const { state } = useSpamGuard();
  if (!state?.enabled) return null;
  const mode = state.paused
    ? t('spam_status_paused')
    : t(state.mode === 'protect' ? 'spam_mode_protect' : 'spam_mode_monitor');
  return (
    <p
      className="rounded-md border border-border/60 p-2 text-[0.8125rem] text-muted-foreground"
      data-testid="spam-guard-status-line"
    >
      {t('spam_status_line', { mode, blocks: state.blocks })}{' '}
      {state.backend === 'openhop' && `${t('spam_status_openhop_note')} `}
      {t('spam_status_where')}
    </p>
  );
}
