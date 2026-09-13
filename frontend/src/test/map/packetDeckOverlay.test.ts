import { describe, it, expect } from 'vitest';
import { buildPacketLayers } from '../../map/layers/packetDeckOverlay';
import type { PacketRenderModel } from '../../map/packets/packetTimeline';

interface FakeLayer {
  props: Record<string, unknown>;
}

function fakeDeck() {
  class ArcLayer implements FakeLayer {
    props: Record<string, unknown>;
    constructor(p: Record<string, unknown>) {
      this.props = p;
    }
  }
  class ScatterplotLayer implements FakeLayer {
    props: Record<string, unknown>;
    constructor(p: Record<string, unknown>) {
      this.props = p;
    }
  }
  return { ArcLayer, ScatterplotLayer } as unknown as typeof import('deck.gl');
}

const model: PacketRenderModel = {
  arcs: [
    { s: [5, 52, 0], t: [6, 53, 0], color: [10, 20, 30], opacity: 0.5, width: 3, witnessed: true },
  ],
  pulses: [{ pos: [5.5, 52.5, 100], color: [40, 50, 60], k: 1 }],
  glows: [{ pos: [6, 53, 0], color: [70, 80, 90], intensity: 0.5 }],
};

describe('buildPacketLayers', () => {
  it('builds arc, two pulse, and glow layers with stable ids', () => {
    const layers = buildPacketLayers(fakeDeck(), model) as unknown as FakeLayer[];
    expect(layers).toHaveLength(4);
    expect(layers.map((l) => l.props.id)).toEqual([
      'pkt-arcs',
      'pkt-pulse-halo',
      'pkt-pulse-core',
      'pkt-glow',
    ]);
  });

  it('arc colour getter applies freshness opacity to the alpha channel', () => {
    const [arc] = buildPacketLayers(fakeDeck(), model) as unknown as FakeLayer[];
    const getColor = arc.props.getSourceColor as (d: (typeof model.arcs)[0]) => number[];
    // opacity 0.5 -> alpha round(255*0.5) = 128
    expect(getColor(model.arcs[0])).toEqual([10, 20, 30, 128]);
  });

  it('pulse core getter is fully opaque and radius scales with k', () => {
    const layers = buildPacketLayers(fakeDeck(), model) as unknown as FakeLayer[];
    const core = layers[2];
    const getFill = core.props.getFillColor as (d: (typeof model.pulses)[0]) => number[];
    const getRadius = core.props.getRadius as (d: (typeof model.pulses)[0]) => number;
    expect(getFill(model.pulses[0])).toEqual([40, 50, 60, 255]);
    expect(getRadius(model.pulses[0])).toBeCloseTo(5.5, 5); // 2.5 + 3*1
  });

  it('glow getter fades alpha and radius with intensity', () => {
    const layers = buildPacketLayers(fakeDeck(), model) as unknown as FakeLayer[];
    const glow = layers[3];
    const getFill = glow.props.getFillColor as (d: (typeof model.glows)[0]) => number[];
    expect(getFill(model.glows[0])).toEqual([70, 80, 90, 100]); // round(200*0.5)
  });
});
