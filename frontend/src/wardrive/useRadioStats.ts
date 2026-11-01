// The companion's battery and noise floor, read while a radio is connected:
// the battery every minute, the noise floor every 10 s and again after 50 m
// of movement. Both are local requests to the radio (CMD_GET_STATS); nothing
// goes over the air. Noise readings with a usable fix are kept for the map in
// this page load only; none is uploaded or forwarded.
import { useCallback, useEffect, useRef, useState } from 'react';

import { haversineM, isUsableFix } from './capture';
import type { Fix } from './messages';
import type { Companion } from './radio/companion';
import { parseStatsCore, parseStatsRadio } from './radio/protocol';

export const BATTERY_EVERY_MS = 60000;
export const NOISE_EVERY_MS = 10000;
export const NOISE_EVERY_M = 50;
export const MAX_NOISE_READINGS = 5000;

export interface NoiseReading {
  lat: number;
  lon: number;
  noise: number;
  at: number;
}

export function useRadioStats(companion: Pick<Companion, 'stats'> | null, fix: Fix | null) {
  const [batteryMv, setBatteryMv] = useState<number | null>(null);
  const [noiseFloor, setNoiseFloor] = useState<number | null>(null);
  const [noiseReadings, setNoiseReadings] = useState<NoiseReading[]>([]);
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const lastPos = useRef<{ lat: number; lon: number } | null>(null);

  const readNoise = useCallback(async () => {
    if (!companion) return;
    const now = Date.now();
    const at = fixRef.current;
    const placed = isUsableFix(at, now) ? { lat: at.lat, lon: at.lon } : null;
    if (placed) lastPos.current = placed;
    const frame = await companion.stats(1);
    const r = frame ? parseStatsRadio(frame) : null;
    if (!r) return;
    setNoiseFloor(r.noiseFloor);
    if (placed) {
      setNoiseReadings((prev) =>
        [...prev, { ...placed, noise: r.noiseFloor, at: now }].slice(-MAX_NOISE_READINGS)
      );
    }
  }, [companion]);

  useEffect(() => {
    if (!companion) return;
    let live = true;
    const read = async () => {
      const frame = await companion.stats(0);
      const r = frame ? parseStatsCore(frame) : null;
      if (live && r) setBatteryMv(r.batteryMv);
    };
    void read();
    const timer = setInterval(() => void read(), BATTERY_EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
      // Readings belong to the radio they came from.
      setBatteryMv(null);
    };
  }, [companion]);

  useEffect(() => {
    if (!companion) return;
    void readNoise();
    const timer = setInterval(() => void readNoise(), NOISE_EVERY_MS);
    return () => {
      clearInterval(timer);
      setNoiseFloor(null);
      setNoiseReadings([]);
      lastPos.current = null;
    };
  }, [companion, readNoise]);

  // Moved 50 m since the last placed reading: read again now.
  useEffect(() => {
    if (!companion || !isUsableFix(fix, Date.now()) || !lastPos.current) return;
    if (haversineM(lastPos.current, fix) >= NOISE_EVERY_M) void readNoise();
  }, [companion, fix, readNoise]);

  return { batteryMv, noiseFloor, noiseReadings };
}
