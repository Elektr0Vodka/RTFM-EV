import type { Channel } from '../types';
import { useT } from '../i18n';
import { RawPacketPasteInspector } from './RawPacketDetailModal';

// Standalone Tools view wrapping the paste-a-hex inspector that used to be a
// button in the raw packet feed.
export function AnalyzePacketView({ channels }: { channels: Channel[] }) {
  const t = useT();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="font-semibold text-base text-foreground">
          {t('chat_analyze_packet_title')}
        </h2>
        <p className="hidden md:block text-xs text-muted-foreground">
          {t('packet_analyze_description')}
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <RawPacketPasteInspector channels={channels} />
      </div>
    </div>
  );
}
