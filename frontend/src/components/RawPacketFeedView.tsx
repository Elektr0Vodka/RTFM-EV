import { useMemo, useState } from 'react';
import { Volume2, VolumeX, X } from 'lucide-react';

import { MeshCoreDecoder, Utils } from '@michaelhart/meshcore-decoder';

import { RawPacketList } from './RawPacketList';
import { RawPacketInspectorDialog } from './RawPacketDetailModal';
import { usePacketFilters } from '../hooks/usePacketFilters';
import { PacketFilterModal } from './PacketFilterModal';
import { getRawPacketObservationKey } from '../utils/rawPacketIdentity';
import { Button } from './ui/button';
import type { Channel, RawPacket } from '../types';
import {
  KNOWN_PAYLOAD_TYPES,
  classifyDecodedHopByteWidth,
  type HopByteWidthBucket,
} from '../utils/rawPacketStats';
import { createDecoderOptions } from '../utils/rawPacketInspector';
import { useRawPackets } from '../stores/rawPacketStore';
import { useSignalAudio } from '../hooks/useSignalAudio';
import type { SignalAudioTheme } from '../lib/signalAudioEngine';
import {
  getSavedSignalAudioOn,
  getSavedSignalAudioTheme,
  getSavedSignalAudioVolume,
  setSavedSignalAudioOn,
  setSavedSignalAudioTheme,
  setSavedSignalAudioVolume,
} from '../utils/signalAudioPreference';
import { useT } from '../i18n';

const KNOWN_PAYLOAD_TYPE_SET = new Set<string>(KNOWN_PAYLOAD_TYPES);

/**
 * Classify a packet for the feed filters in a single decode pass: its payload
 * type and its hop-byte-width bucket. Sharing one decode avoids a second pass
 * per packet on a buffer that can update several times a second.
 */
function summarizePacketForFeed(
  packet: RawPacket,
  decoderOptions?: ReturnType<typeof createDecoderOptions>
): { payloadType: string; hopWidth: HopByteWidthBucket; isDirect: boolean } {
  try {
    const decoded = MeshCoreDecoder.decode(packet.data, decoderOptions);
    const name = decoded.isValid ? Utils.getPayloadTypeName(decoded.payloadType) : 'Unknown';
    const hopWidth = classifyDecodedHopByteWidth(decoded);
    return {
      payloadType: KNOWN_PAYLOAD_TYPE_SET.has(name) ? name : 'Unknown',
      hopWidth,
      // Direct = decoded successfully and carries no path (0 hops), i.e. heard
      // directly from a neighbour. `No path` alone also covers undecodable
      // packets, so gate on isValid to avoid over-claiming.
      isDirect: decoded.isValid && hopWidth === 'No path',
    };
  } catch {
    return { payloadType: 'Unknown', hopWidth: 'No path', isDirect: false };
  }
}

interface RawPacketFeedViewProps {
  channels: Channel[];
}

export function RawPacketFeedView({ channels }: RawPacketFeedViewProps) {
  const t = useT();
  const packets = useRawPackets();
  const [selectedPacket, setSelectedPacket] = useState<RawPacket | null>(null);
  // Payload-type / hop-width / hex / group filter state (session-only).
  const filters = usePacketFilters();
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  // Autoscroll defaults on; intentionally not persisted across refreshes.
  const [autoScroll, setAutoScroll] = useState(true);
  // Per-packet signal audio (Geiger / sonar). Persisted per-browser; off by default.
  const [soundOn, setSoundOn] = useState(getSavedSignalAudioOn);
  const [soundVolume, setSoundVolume] = useState(getSavedSignalAudioVolume);
  const [soundTheme, setSoundTheme] = useState<SignalAudioTheme>(getSavedSignalAudioTheme);
  useSignalAudio({ enabled: soundOn, volume: soundVolume, theme: soundTheme });

  const handleToggleSound = () => {
    setSoundOn((prev) => {
      const next = !prev;
      setSavedSignalAudioOn(next);
      return next;
    });
  };
  const handleSoundVolumeChange = (value: number) => {
    setSoundVolume(value);
    setSavedSignalAudioVolume(value);
  };
  const handleSoundThemeChange = (theme: SignalAudioTheme) => {
    setSoundTheme(theme);
    setSavedSignalAudioTheme(theme);
  };

  const decoderOptions = useMemo(() => createDecoderOptions(channels), [channels]);

  const packetsWithTypes = useMemo(
    () =>
      packets.map((packet) => ({
        packet,
        ...summarizePacketForFeed(packet, decoderOptions),
      })),
    [packets, decoderOptions]
  );

  const directPacketKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const { packet, isDirect } of packetsWithTypes) {
      if (isDirect) keys.add(getRawPacketObservationKey(packet));
    }
    return keys;
  }, [packetsWithTypes]);

  const filteredPackets = useMemo(() => {
    // A non-hex query matches nothing; the input surfaces a hint instead.
    if (filters.hexInvalid) return [];
    // Fast path: no filters active.
    if (filters.allTypesEnabled && filters.allHopWidthsEnabled && filters.hexQuery === '') {
      return packets;
    }
    return packetsWithTypes
      .filter(
        ({ packet, payloadType, hopWidth }) =>
          (filters.allTypesEnabled || filters.enabledTypes.has(payloadType)) &&
          (filters.allHopWidthsEnabled || filters.enabledHopWidths.has(hopWidth)) &&
          (filters.hexQuery === '' || packet.data.toLowerCase().includes(filters.hexQuery))
      )
      .map(({ packet }) => packet);
  }, [
    packetsWithTypes,
    packets,
    filters.allTypesEnabled,
    filters.allHopWidthsEnabled,
    filters.enabledTypes,
    filters.enabledHopWidths,
    filters.hexQuery,
    filters.hexInvalid,
  ]);

  return (
    <>
      <div className="border-b border-border px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-base text-foreground">
              {t('nav_raw_packet_feed_name')}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={soundOn ? 'default' : 'outline'}
              size="sm"
              onClick={handleToggleSound}
              aria-pressed={soundOn}
              title={t('packet_sound_tip')}
            >
              {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              <span className="hidden sm:inline">{t('packet_sound')}</span>
            </Button>
            {soundOn && (
              <>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={soundVolume}
                  onChange={(event) => handleSoundVolumeChange(Number(event.target.value))}
                  aria-label={t('packet_sound_volume')}
                  className="w-20 accent-primary"
                />
                <select
                  value={soundTheme}
                  onChange={(event) =>
                    handleSoundThemeChange(event.target.value as SignalAudioTheme)
                  }
                  aria-label={t('packet_sound_theme')}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                >
                  <option value="geiger">{t('packet_sound_theme_geiger')}</option>
                  <option value="sonar">{t('packet_sound_theme_sonar')}</option>
                  <option value="waterdrip">{t('packet_sound_theme_waterdrip')}</option>
                </select>
              </>
            )}
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="relative">
            <input
              type="text"
              value={filters.hexFilter}
              onChange={(event) => filters.setHexFilter(event.target.value)}
              placeholder={t('packet_filter_hex_placeholder')}
              aria-label={t('packet_filter_hex_aria')}
              className="w-44 rounded border border-input bg-background px-2 py-0.5 pr-6 text-xs"
            />
            {filters.hexFilter !== '' && (
              <button
                type="button"
                onClick={() => filters.setHexFilter('')}
                aria-label={t('packet_clear_hex_filter_aria')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {filters.hexFilter.trim() !== '' &&
            (filters.hexInvalid ? (
              <span className="text-[0.6875rem] text-warning">
                {t('packet_hex_filter_invalid')}
              </span>
            ) : (
              <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
                {filteredPackets.length.toLocaleString()} / {packets.length.toLocaleString()}
              </span>
            ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFilterModalOpen(true)}
            aria-expanded={filterModalOpen}
          >
            {t('packet_filters_button')}
            {filters.activeFilterCount > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 text-[0.625rem] font-semibold text-primary-foreground tabular-nums">
                {filters.activeFilterCount}
              </span>
            )}
          </Button>
          <label className="ml-auto flex items-center gap-1 text-xs text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(event) => setAutoScroll(event.target.checked)}
              className="rounded"
            />
            {t('packet_autoscroll_label')}
          </label>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 min-w-0 flex-1">
          <RawPacketList
            packets={filteredPackets}
            channels={channels}
            onPacketClick={setSelectedPacket}
            autoScroll={autoScroll}
            directPacketKeys={directPacketKeys}
          />
        </div>
      </div>

      <RawPacketInspectorDialog
        open={selectedPacket !== null}
        onOpenChange={(isOpen) => !isOpen && setSelectedPacket(null)}
        channels={channels}
        source={
          selectedPacket
            ? { kind: 'packet', packet: selectedPacket }
            : { kind: 'loading', message: t('packet_loading_message') }
        }
        title={t('packet_details_title')}
        description={t('packet_details_description')}
      />

      <PacketFilterModal
        open={filterModalOpen}
        onOpenChange={setFilterModalOpen}
        enabledTypes={filters.enabledTypes}
        enabledHopWidths={filters.enabledHopWidths}
        allTypesEnabled={filters.allTypesEnabled}
        allHopWidthsEnabled={filters.allHopWidthsEnabled}
        groupByHash={filters.groupByHash}
        onToggleAll={filters.toggleAll}
        onToggleType={filters.toggleType}
        onOnlyType={filters.onlyType}
        onToggleAllHopWidths={filters.toggleAllHopWidths}
        onToggleHopWidth={filters.toggleHopWidth}
        onOnlyHopWidth={filters.onlyHopWidth}
        onGroupByHashChange={filters.setGroupByHash}
        onReset={filters.reset}
        matchCount={filteredPackets.length}
        totalCount={packets.length}
      />
    </>
  );
}
