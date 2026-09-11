import { describe, it, expect } from 'vitest';
import {
  COMMUNITY_MQTT_PRESETS,
  applyPresetToConfig,
  detectPresetId,
  CUSTOM_PRESET_ID,
} from '../components/settings/communityMqttPresets';

describe('communityMqttPresets', () => {
  it('contains 37 presets with unique ids', () => {
    expect(COMMUNITY_MQTT_PRESETS).toHaveLength(37);
    const ids = COMMUNITY_MQTT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(37);
  });

  it('parses a wss JWT preset into websockets + tls + token', () => {
    const p = COMMUNITY_MQTT_PRESETS.find((x) => x.id === 'bsmesh')!;
    const cfg = applyPresetToConfig({}, p);
    expect(cfg).toMatchObject({
      broker_host: 'mqtt.bsmesh.de',
      broker_port: 8885,
      transport: 'websockets',
      use_tls: true,
      tls_verify: true,
      auth_mode: 'token',
      token_audience: 'mqtt.bsmesh.de',
      websocket_path: '/',
    });
  });

  it('parses a mqtt USERPASS preset with embedded credentials', () => {
    const p = COMMUNITY_MQTT_PRESETS.find((x) => x.id === 'tennmesh')!;
    const cfg = applyPresetToConfig({}, p);
    expect(cfg).toMatchObject({
      broker_host: 'mqtt.tennmesh.com',
      broker_port: 1883,
      transport: 'tcp',
      use_tls: false,
      auth_mode: 'password',
      username: 'mqttfeed',
      password: 'tc2live',
    });
  });

  it('carries the {pubkey} sentinel for mesh-chaun14', () => {
    const p = COMMUNITY_MQTT_PRESETS.find((x) => x.id === 'mesh-chaun14')!;
    expect(applyPresetToConfig({}, p).username).toBe('{pubkey}');
  });

  it('leaves topic_template blank for meshrank and flags it required', () => {
    const p = COMMUNITY_MQTT_PRESETS.find((x) => x.id === 'meshrank')!;
    expect(p.requiresTopicTemplate).toBe(true);
    expect(applyPresetToConfig({}, p).topic_template).toBe('');
  });

  it('preserves user-entered iata/email/topic_template when applying a preset', () => {
    const p = COMMUNITY_MQTT_PRESETS.find((x) => x.id === 'analyzer-eu')!;
    const cfg = applyPresetToConfig({ iata: 'AMS', email: 'a@b.c' }, p);
    expect(cfg.iata).toBe('AMS');
    expect(cfg.email).toBe('a@b.c');
  });

  it('round-trips detectPresetId for a stamped config', () => {
    const p = COMMUNITY_MQTT_PRESETS.find((x) => x.id === 'dutchmeshcore-1')!;
    expect(detectPresetId(applyPresetToConfig({}, p))).toBe('dutchmeshcore-1');
  });

  it('returns CUSTOM_PRESET_ID for an unrecognized config', () => {
    expect(detectPresetId({ broker_host: 'example.invalid', broker_port: 12345 })).toBe(
      CUSTOM_PRESET_ID
    );
  });
});
