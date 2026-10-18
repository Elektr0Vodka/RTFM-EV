import { useCallback } from 'react';
import { useDistanceUnit } from '../../contexts/DistanceUnitContext';
import { useCvdMode } from '../../hooks/useCvdColors';
import { useT } from '../../i18n';
import type { Contact, Message, MessagePath, RadioConfig } from '../../types';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { parseSenderFromText } from '../../utils/messageParser';
import { formatDistance, resolvePath, type SenderInfo } from '../../utils/pathUtils';
import { shareFilename } from '../filename';
import { loadShareBrand } from '../shareBrand';
import type { CardFigure, CardText } from '../cardChrome';
import type { ShareBuildOptions, ShareCardResult } from '../ShareCardDialog';
import { buildMessageRouteModel } from './messageRoute';
import { renderMessageRouteCard } from './messageRouteRender';

/** What the message list hands the share dialog for one message. */
export interface MessageShareTarget {
  message: Message;
  paths: MessagePath[];
  senderInfo: SenderInfo;
  /** Channel name for a channel message, the other party's name for a DM. */
  conversationLabel: string;
  isChannel: boolean;
}

/** Card 1: turns a message and its paths into the share dialog's `build`. */
export function useMessageRouteBuild(
  target: MessageShareTarget | null,
  contacts: Contact[],
  config: RadioConfig | null
): ((opts: ShareBuildOptions) => Promise<ShareCardResult>) | null {
  const t = useT();
  const { distanceUnit } = useDistanceUnit();
  const cvd = useCvdMode();

  const build = useCallback(
    async (opts: ShareBuildOptions): Promise<ShareCardResult> => {
      if (!target) throw new Error('nothing to share');
      const { message, senderInfo } = target;
      const outgoing = message.outgoing;
      const parsed = target.isChannel
        ? parseSenderFromText(message.text)
        : { sender: null, content: message.text };
      const senderName = parsed.sender || message.sender_name || senderInfo.name;

      const model = buildMessageRouteModel({
        outgoing,
        paths: target.paths.map((p) => ({
          ...p,
          resolved: resolvePath(p.path, senderInfo, contacts, config, p.path_len),
        })),
      });

      const time = formatDateTime(message.received_at * 1000, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const figures: CardFigure[] = [
        {
          value: String(model.routeCount),
          label: t('share_fig_routes', { count: model.routeCount }),
        },
        {
          value:
            model.hopsMin === model.hopsMax
              ? String(model.hopsMin)
              : t('share_fig_range', { min: model.hopsMin, max: model.hopsMax }),
          label: t('share_fig_hops', { count: model.hopsMax }),
        },
      ];
      if (model.straightKm != null) {
        figures.push({
          value: formatDistance(model.straightKm, distanceUnit),
          label: t('share_fig_straight_line'),
        });
      }
      if (model.bestSnr != null) {
        figures.push({
          value: t('share_fig_snr_value', { snr: model.bestSnr.toFixed(1) }),
          label: t('share_fig_snr_at_me'),
        });
      }

      const title = outgoing
        ? t('share_msg_title_outgoing')
        : t('share_msg_title', { name: senderName });
      const text: CardText = {
        kicker: target.isChannel
          ? t('share_msg_kicker_channel', { channel: target.conversationLabel, time })
          : t('share_msg_kicker_dm', { name: target.conversationLabel, time }),
        title,
        quote: parsed.content,
        figures,
      };

      const brand = await loadShareBrand();
      const { png, gif } = await renderMessageRouteCard(model, text, brand, { ...opts, cvd });
      return {
        png,
        gif,
        filenameBase: shareFilename('message', new Date(message.received_at * 1000)),
        alt: outgoing ? t('share_msg_alt_outgoing') : t('share_msg_alt', { name: senderName }),
        shareTitle: title,
      };
    },
    [target, contacts, config, t, distanceUnit, cvd]
  );

  return target ? build : null;
}
