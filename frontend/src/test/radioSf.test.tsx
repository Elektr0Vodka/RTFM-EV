import { act, render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { MessageSfPill, RadioSfPills } from '../components/RadioSfPill';
import { usePacketFilters } from '../hooks/usePacketFilters';
import type { ContactRadioSighting, RadioStamp } from '../types';
import {
  SF_FILTER_BUCKETS,
  contactHiddenBySf,
  contactPillStamps,
  isNonNormal,
  packetSfBucket,
  parseRadioFields,
  pillLabels,
} from '../utils/radioSf';
import { INACTIVE_TEMP_RADIO, setCurrentRadioStamp, setTempRadioState } from '../utils/tempRadio';

const SF7: RadioStamp = { freq: 869.618, bw: 62.5, sf: 7, cr: 8 };
const SF8: RadioStamp = { freq: 869.618, bw: 62.5, sf: 8, cr: 8 };
const SF8_OTHER_FREQ: RadioStamp = { freq: 869.525, bw: 62.5, sf: 8, cr: 8 };

const seen = (stamp: RadioStamp): ContactRadioSighting => ({
  ...stamp,
  first_seen: 1,
  last_seen: 2,
});

describe('radioSf helpers', () => {
  it('labels by SF, adding the frequency only when two share an SF', () => {
    expect(pillLabels([SF7, SF8])).toEqual(['SF7', 'SF8']);
    expect(pillLabels([SF8, SF8_OTHER_FREQ])).toEqual(['SF8 869.618', 'SF8 869.525']);
  });

  it('treats null stamps and normal stamps as no pill', () => {
    expect(isNonNormal(null, SF7)).toBe(false);
    expect(isNonNormal(SF7, SF7)).toBe(false);
    expect(isNonNormal(SF8, SF7)).toBe(true);
    expect(isNonNormal(SF8, null)).toBe(false);
  });

  it('lists every contact sighting only when one differs from normal', () => {
    expect(contactPillStamps([seen(SF7)], SF7)).toEqual([]);
    expect(contactPillStamps([seen(SF7), seen(SF8)], SF7)).toEqual([SF7, SF8]);
    expect(contactPillStamps([], SF7)).toEqual([]);
  });

  it('hides a contact only when every SF it was heard on is hidden', () => {
    expect(contactHiddenBySf([seen(SF7), seen(SF8)], new Set([8]))).toBe(false);
    expect(contactHiddenBySf([seen(SF8)], new Set([8]))).toBe(true);
    expect(contactHiddenBySf([], new Set([0]))).toBe(true);
    expect(contactHiddenBySf([], new Set([8]))).toBe(false);
  });

  it('buckets packets by SF with Unknown for older rows', () => {
    expect(packetSfBucket(SF8)).toBe('SF8');
    expect(packetSfBucket(null)).toBe('Unknown');
    expect(SF_FILTER_BUCKETS).toContain('Unknown');
    expect(SF_FILTER_BUCKETS).toContain('SF12');
  });

  it('validates the firmware ranges', () => {
    expect(parseRadioFields({ freq: '869.618', bw: '62.5', sf: '8', cr: '8' }).error).toBeNull();
    expect(parseRadioFields({ freq: '100', bw: '62.5', sf: '8', cr: '8' }).error).toBe(
      'temp_radio_error_freq'
    );
    expect(parseRadioFields({ freq: '869', bw: '600', sf: '8', cr: '8' }).error).toBe(
      'temp_radio_error_bw'
    );
    expect(parseRadioFields({ freq: '869', bw: '62.5', sf: '8', cr: '4' }).error).toBe(
      'temp_radio_error_cr'
    );
  });
});

describe('SF pills', () => {
  beforeEach(() => {
    act(() => {
      setTempRadioState(INACTIVE_TEMP_RADIO);
      setCurrentRadioStamp(SF7);
    });
  });

  it('shows a pill for a message heard on other settings, with the full settings as title', () => {
    render(<MessageSfPill stamp={SF8} />);
    const pill = screen.getByText('SF8');
    expect(pill).toHaveAttribute('title', expect.stringContaining('869.618 MHz'));
  });

  it('shows nothing for normal or unknown settings', () => {
    const { container } = render(
      <>
        <MessageSfPill stamp={SF7} />
        <MessageSfPill stamp={null} />
      </>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('compares against the stored original while a session runs', () => {
    act(() => {
      setCurrentRadioStamp(SF8);
      setTempRadioState({ ...INACTIVE_TEMP_RADIO, active: true, original: SF7, temp: SF8 });
    });
    render(<MessageSfPill stamp={SF8} />);
    expect(screen.getByText('SF8')).toBeInTheDocument();
  });

  it('renders a pill per settings set', () => {
    render(<RadioSfPills stamps={[SF7, SF8]} />);
    expect(screen.getByText('SF7')).toBeInTheDocument();
    expect(screen.getByText('SF8')).toBeInTheDocument();
  });
});

describe('usePacketFilters SF buckets', () => {
  it('starts with every SF shown and counts a hidden one as a filter', () => {
    const { result } = renderHook(() => usePacketFilters());
    expect(result.current.allSfsEnabled).toBe(true);
    act(() => result.current.toggleSf('SF8'));
    expect(result.current.enabledSfs.has('SF8')).toBe(false);
    expect(result.current.activeFilterCount).toBe(1);
    act(() => result.current.onlySf('Unknown'));
    expect([...result.current.enabledSfs]).toEqual(['Unknown']);
    act(() => result.current.reset());
    expect(result.current.allSfsEnabled).toBe(true);
  });
});
