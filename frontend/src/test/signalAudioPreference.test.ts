import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSavedSignalAudioOn,
  setSavedSignalAudioOn,
  getSavedSignalAudioVolume,
  setSavedSignalAudioVolume,
  getSavedSignalAudioTheme,
  setSavedSignalAudioTheme,
} from '../utils/signalAudioPreference';

beforeEach(() => {
  localStorage.clear();
});

describe('signal audio on/off preference', () => {
  it('defaults to off', () => {
    expect(getSavedSignalAudioOn()).toBe(false);
  });

  it('round-trips true and clears back to default on false', () => {
    setSavedSignalAudioOn(true);
    expect(getSavedSignalAudioOn()).toBe(true);
    setSavedSignalAudioOn(false);
    expect(getSavedSignalAudioOn()).toBe(false);
  });
});

describe('signal audio volume preference', () => {
  it('defaults to 0.5', () => {
    expect(getSavedSignalAudioVolume()).toBeCloseTo(0.5);
  });

  it('round-trips a valid volume', () => {
    setSavedSignalAudioVolume(0.3);
    expect(getSavedSignalAudioVolume()).toBeCloseTo(0.3);
  });

  it('clamps stored values to 0..1', () => {
    setSavedSignalAudioVolume(5);
    expect(getSavedSignalAudioVolume()).toBe(1);
    setSavedSignalAudioVolume(-2);
    expect(getSavedSignalAudioVolume()).toBe(0);
  });

  it('falls back to the default for a non-numeric stored value', () => {
    localStorage.setItem('remoteterm-signal-audio-volume', 'not-a-number');
    expect(getSavedSignalAudioVolume()).toBeCloseTo(0.5);
  });
});

describe('signal audio theme preference', () => {
  it('defaults to geiger', () => {
    expect(getSavedSignalAudioTheme()).toBe('geiger');
  });

  it('round-trips a valid theme', () => {
    setSavedSignalAudioTheme('sonar');
    expect(getSavedSignalAudioTheme()).toBe('sonar');
  });

  it('falls back to geiger for an unknown stored theme', () => {
    localStorage.setItem('remoteterm-signal-audio-theme', 'bogus');
    expect(getSavedSignalAudioTheme()).toBe('geiger');
  });
});
