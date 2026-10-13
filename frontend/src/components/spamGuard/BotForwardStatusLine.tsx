import { useT } from '../../i18n';
import type { BotForwardStatus } from '../../types';
import { botForwardStatusText } from '../../utils/botForwardStatus';

/**
 * One line on the Spam Guard Settings tab: what the bot lists' Block forwards
 * switch adds to the rules, and where those lists are kept.
 */
export function BotForwardStatusLine({ forward }: { forward: BotForwardStatus }) {
  const t = useT();
  return (
    <p
      className="rounded-md border border-border/60 p-2 text-[0.8125rem] text-muted-foreground"
      data-testid="spam-bot-forward-line"
    >
      {forward.names === 0
        ? t('spam_bot_forward_none')
        : t('spam_bot_forward_line', {
            status: botForwardStatusText(t, forward),
            count: forward.names,
          })}{' '}
      {t('spam_bot_forward_where')}
    </p>
  );
}
