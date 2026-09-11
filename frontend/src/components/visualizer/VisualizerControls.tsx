import { useEffect, useState } from 'react';
import { Checkbox } from '../ui/checkbox';
import { PACKET_LEGEND_ITEMS } from '../../utils/visualizerUtils';
import { NODE_LEGEND_ITEMS } from './shared';
import { useT } from '../../i18n';

// PACKET_LEGEND_ITEMS/NODE_LEGEND_ITEMS (utils/visualizerUtils.ts, ./shared.ts)
// are shared, non-i18n data modules outside this migration's scope. Map their
// stable `label` values to catalog keys here instead of translating the
// `description`/`label` fields in place.
const PACKET_LEGEND_KEYS: Record<string, string> = {
  AD: 'visualizer_legend_packet_advertisement',
  GT: 'visualizer_legend_packet_group_text',
  DM: 'visualizer_legend_packet_direct_message',
  ACK: 'visualizer_legend_packet_acknowledgment',
  TR: 'nav_trace',
  RQ: 'visualizer_legend_packet_request',
  RS: 'visualizer_legend_packet_response',
  '?': 'visualizer_legend_packet_other',
};

const NODE_LEGEND_KEYS: Record<string, string> = {
  You: 'common_you',
  Repeater: 'common_repeater',
  Node: 'visualizer_legend_node_node',
  Ambiguous: 'visualizer_legend_node_ambiguous',
};

interface VisualizerControlsProps {
  showControls: boolean;
  setShowControls: (value: boolean) => void;
  fullScreen?: boolean;
  onFullScreenChange?: (fullScreen: boolean) => void;
  showAmbiguousPaths: boolean;
  setShowAmbiguousPaths: (value: boolean) => void;
  showAmbiguousNodes: boolean;
  setShowAmbiguousNodes: (value: boolean) => void;
  useAdvertPathHints: boolean;
  setUseAdvertPathHints: (value: boolean) => void;
  collapseLikelyKnownSiblingRepeaters: boolean;
  setCollapseLikelyKnownSiblingRepeaters: (value: boolean) => void;
  splitAmbiguousByTraffic: boolean;
  setSplitAmbiguousByTraffic: (value: boolean) => void;
  observationWindowSec: number;
  setObservationWindowSec: (value: number) => void;
  pruneStaleNodes: boolean;
  setPruneStaleNodes: (value: boolean) => void;
  pruneStaleMinutes: number;
  setPruneStaleMinutes: (value: number) => void;
  letEmDrift: boolean;
  setLetEmDrift: (value: boolean) => void;
  autoOrbit: boolean;
  setAutoOrbit: (value: boolean) => void;
  chargeStrength: number;
  setChargeStrength: (value: number) => void;
  particleSpeedMultiplier: number;
  setParticleSpeedMultiplier: (value: number) => void;
  nodeCount: number;
  linkCount: number;
  onExpandContract: () => void;
  onClearAndReset: () => void;
}

export function VisualizerControls({
  showControls,
  setShowControls,
  fullScreen,
  onFullScreenChange,
  showAmbiguousPaths,
  setShowAmbiguousPaths,
  showAmbiguousNodes,
  setShowAmbiguousNodes,
  useAdvertPathHints,
  setUseAdvertPathHints,
  collapseLikelyKnownSiblingRepeaters,
  setCollapseLikelyKnownSiblingRepeaters,
  splitAmbiguousByTraffic,
  setSplitAmbiguousByTraffic,
  observationWindowSec,
  setObservationWindowSec,
  pruneStaleNodes,
  setPruneStaleNodes,
  pruneStaleMinutes,
  setPruneStaleMinutes,
  letEmDrift,
  setLetEmDrift,
  autoOrbit,
  setAutoOrbit,
  chargeStrength,
  setChargeStrength,
  particleSpeedMultiplier,
  setParticleSpeedMultiplier,
  nodeCount,
  linkCount,
  onExpandContract,
  onClearAndReset,
}: VisualizerControlsProps) {
  const t = useT();
  const [observationWindowInput, setObservationWindowInput] = useState(
    String(observationWindowSec)
  );
  const [pruneWindowInput, setPruneWindowInput] = useState(String(pruneStaleMinutes));

  useEffect(() => {
    setObservationWindowInput(String(observationWindowSec));
  }, [observationWindowSec]);

  useEffect(() => {
    setPruneWindowInput(String(pruneStaleMinutes));
  }, [pruneStaleMinutes]);

  return (
    <>
      {showControls && (
        <div className="absolute bottom-4 left-4 bg-background/80 backdrop-blur-sm rounded-lg p-3 text-xs border border-border z-10">
          <div className="flex gap-6">
            <div className="flex flex-col gap-1.5">
              <div className="text-muted-foreground font-medium mb-1">
                {t('visualizer_controls_packets_heading')}
              </div>
              {PACKET_LEGEND_ITEMS.map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[0.5rem] font-bold text-white"
                    style={{ backgroundColor: item.color }}
                  >
                    {item.label}
                  </div>
                  <span>{t(PACKET_LEGEND_KEYS[item.label] ?? item.description)}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="text-muted-foreground font-medium mb-1">
                {t('visualizer_controls_nodes_heading')}
              </div>
              {NODE_LEGEND_ITEMS.map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <div
                    className="rounded-full"
                    style={{
                      width: item.size,
                      height: item.size,
                      backgroundColor: item.color,
                    }}
                  />
                  <span>{t(NODE_LEGEND_KEYS[item.label] ?? item.label)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div
        className={`absolute top-4 left-4 bg-background/80 backdrop-blur-sm rounded-lg p-3 text-xs border border-border z-10 transition-opacity ${!showControls ? 'opacity-40 hover:opacity-100' : ''}`}
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={showControls}
                onCheckedChange={(c) => setShowControls(c === true)}
              />
              <span title={t('visualizer_controls_toggle_title')}>
                {t('visualizer_controls_show_controls')}
              </span>
            </label>
            {onFullScreenChange && (
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={!fullScreen}
                  onCheckedChange={(c) => onFullScreenChange(c !== true)}
                />
                <span title={t('visualizer_controls_packet_feed_sidebar_title')}>
                  {t('visualizer_controls_show_packet_feed_sidebar')}
                </span>
              </label>
            )}
          </div>
          {showControls && (
            <>
              <div className="border-t border-border pt-2 mt-1 flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={showAmbiguousPaths}
                    onCheckedChange={(c) => setShowAmbiguousPaths(c === true)}
                  />
                  <span title={t('visualizer_controls_ambiguous_repeaters_title')}>
                    {t('visualizer_controls_show_ambiguous_repeaters')}
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={showAmbiguousNodes}
                    onCheckedChange={(c) => setShowAmbiguousNodes(c === true)}
                  />
                  <span title={t('visualizer_controls_ambiguous_sender_title')}>
                    {t('visualizer_controls_show_ambiguous_sender')}
                  </span>
                </label>
                <details className="rounded border border-border/60 px-2 py-1">
                  <summary className="cursor-pointer select-none text-muted-foreground">
                    {t('visualizer_controls_advanced')}
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={useAdvertPathHints}
                        onCheckedChange={(c) => setUseAdvertPathHints(c === true)}
                        disabled={!showAmbiguousPaths}
                      />
                      <span
                        title={t('visualizer_controls_advert_hints_title')}
                        className={!showAmbiguousPaths ? 'text-muted-foreground' : ''}
                      >
                        {t('visualizer_controls_advert_hints_label')}
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={collapseLikelyKnownSiblingRepeaters}
                        onCheckedChange={(c) => setCollapseLikelyKnownSiblingRepeaters(c === true)}
                        disabled={!showAmbiguousPaths || !useAdvertPathHints}
                      />
                      <span
                        title={t('visualizer_controls_collapse_siblings_title')}
                        className={
                          !showAmbiguousPaths || !useAdvertPathHints ? 'text-muted-foreground' : ''
                        }
                      >
                        {t('visualizer_controls_collapse_siblings_label')}
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={splitAmbiguousByTraffic}
                        onCheckedChange={(c) => setSplitAmbiguousByTraffic(c === true)}
                        disabled={!showAmbiguousPaths}
                      />
                      <span
                        title={t('visualizer_controls_split_traffic_title')}
                        className={!showAmbiguousPaths ? 'text-muted-foreground' : ''}
                      >
                        {t('visualizer_controls_split_traffic_label')}
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      <label
                        htmlFor="observation-window-3d"
                        className="text-muted-foreground"
                        title={t('visualizer_controls_observation_window_title')}
                      >
                        {t('visualizer_controls_observation_window_label')}
                      </label>
                      <input
                        id="observation-window-3d"
                        type="number"
                        min="1"
                        max="60"
                        value={observationWindowInput}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          setObservationWindowInput(nextValue);
                          if (nextValue === '') return;
                          const parsed = Number.parseInt(nextValue, 10);
                          if (Number.isNaN(parsed)) return;
                          setObservationWindowSec(Math.max(1, Math.min(60, parsed)));
                        }}
                        onBlur={() => {
                          const parsed = Number.parseInt(observationWindowInput, 10);
                          const nextValue = Number.isNaN(parsed)
                            ? observationWindowSec
                            : Math.max(1, Math.min(60, parsed));
                          setObservationWindowInput(String(nextValue));
                          if (nextValue !== observationWindowSec) {
                            setObservationWindowSec(nextValue);
                          }
                        }}
                        className="w-12 px-1 py-0.5 bg-background border border-border rounded text-xs text-center"
                      />
                      <span className="text-muted-foreground">
                        {t('visualizer_controls_seconds_unit')}
                      </span>
                    </div>
                  </div>
                </details>
                <div className="border-t border-border pt-2 mt-1 flex flex-col gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={pruneStaleNodes}
                      onCheckedChange={(c) => setPruneStaleNodes(c === true)}
                    />
                    <span title={t('visualizer_controls_prune_stale_title')}>
                      {t('visualizer_controls_prune_stale_label')}
                    </span>
                  </label>
                  {pruneStaleNodes && (
                    <div className="flex items-center gap-2 pl-6">
                      <label
                        htmlFor="prune-window"
                        className="text-muted-foreground whitespace-nowrap"
                      >
                        {t('visualizer_controls_window_label')}
                      </label>
                      <input
                        id="prune-window"
                        type="number"
                        min={1}
                        max={60}
                        value={pruneWindowInput}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          setPruneWindowInput(nextValue);
                          if (nextValue === '') return;
                          const parsed = Number.parseInt(nextValue, 10);
                          if (Number.isNaN(parsed)) return;
                          if (parsed >= 1 && parsed <= 60) setPruneStaleMinutes(parsed);
                        }}
                        onBlur={() => {
                          const parsed = Number.parseInt(pruneWindowInput, 10);
                          const nextValue =
                            Number.isNaN(parsed) || parsed < 1 || parsed > 60
                              ? pruneStaleMinutes
                              : parsed;
                          setPruneWindowInput(String(nextValue));
                          if (nextValue !== pruneStaleMinutes) {
                            setPruneStaleMinutes(nextValue);
                          }
                        }}
                        className="w-14 rounded border border-border bg-background px-2 py-0.5 text-sm"
                      />
                      <span className="text-muted-foreground" aria-hidden="true">
                        {t('visualizer_controls_minutes_unit')}
                      </span>
                    </div>
                  )}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={letEmDrift}
                      onCheckedChange={(c) => setLetEmDrift(c === true)}
                    />
                    <span title={t('visualizer_controls_let_drift_title')}>
                      {t('visualizer_controls_let_drift_label')}
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={autoOrbit}
                      onCheckedChange={(c) => setAutoOrbit(c === true)}
                    />
                    <span title={t('visualizer_controls_orbit_title')}>
                      {t('visualizer_controls_orbit_label')}
                    </span>
                  </label>
                  <div className="flex flex-col gap-1 mt-1">
                    <label
                      htmlFor="viz-repulsion"
                      className="text-muted-foreground"
                      title={t('visualizer_controls_repulsion_title')}
                    >
                      {t('visualizer_controls_repulsion_label', {
                        value: Math.abs(chargeStrength),
                      })}
                    </label>
                    <input
                      id="viz-repulsion"
                      type="range"
                      min="50"
                      max="2500"
                      value={Math.abs(chargeStrength)}
                      onChange={(e) => setChargeStrength(-parseInt(e.target.value, 10))}
                      className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  </div>
                  <div className="flex flex-col gap-1 mt-1">
                    <label
                      htmlFor="viz-packet-speed"
                      className="text-muted-foreground"
                      title={t('visualizer_controls_packet_speed_title')}
                    >
                      {t('visualizer_controls_packet_speed_label', {
                        value: particleSpeedMultiplier,
                      })}
                    </label>
                    <input
                      id="viz-packet-speed"
                      type="range"
                      min="1"
                      max="5"
                      step="0.5"
                      value={particleSpeedMultiplier}
                      onChange={(e) => setParticleSpeedMultiplier(parseFloat(e.target.value))}
                      className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  </div>
                </div>
                <button
                  onClick={onExpandContract}
                  className="mt-1 px-3 py-1.5 bg-primary/20 hover:bg-primary/30 text-primary rounded text-xs transition-colors"
                  title={t('visualizer_controls_expand_contract_title')}
                >
                  {t('visualizer_controls_expand_contract_button')}
                </button>
                <button
                  onClick={onClearAndReset}
                  className="mt-1 rounded border border-warning/40 bg-warning/10 px-3 py-1.5 text-warning text-xs transition-colors hover:bg-warning/20"
                  title={t('visualizer_controls_clear_reset_title')}
                >
                  {t('visualizer_controls_clear_reset_button')}
                </button>
              </div>
              <div className="border-t border-border pt-2 mt-1">
                <div>{t('visualizer_controls_nodes_stat', { count: nodeCount })}</div>
                <div>{t('visualizer_controls_links_stat', { count: linkCount })}</div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
