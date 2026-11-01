import { describe, expect, it } from 'vitest';

import { NmeaLineReader, NmeaFixBuilder, parseNmea } from '../../wardrive/position/nmea';

const GGA = '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47';
const GGA_SOUTH_WEST = '$GPGGA,123519,5207.038,S,00431.000,W,1,08,1.2,5.4,M,46.9,M,,*4C';
const GGA_NO_FIX = '$GPGGA,123519,4807.038,N,01131.000,E,0,00,,545.4,M,46.9,M,,*69';
const RMC = '$GNRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*74';
const RMC_VOID = '$GPRMC,123519,V,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*7D';

describe('NMEA', () => {
  it('reads a GGA fix with HDOP as an accuracy estimate', () => {
    const fix = parseNmea(GGA);
    expect(fix?.lat).toBeCloseTo(48.1173, 4);
    expect(fix?.lon).toBeCloseTo(11.516667, 5);
    expect(fix?.accM).toBeCloseTo(4.5, 6);
  });

  it('reads south and west as negative', () => {
    const fix = parseNmea(GGA_SOUTH_WEST);
    expect(fix?.lat).toBeCloseTo(-52.1173, 4);
    expect(fix?.lon).toBeCloseTo(-4.516667, 5);
  });

  it('reads speed and course from an RMC sentence', () => {
    const fix = parseNmea(RMC);
    // 22.4 knots, course 84.4 degrees.
    expect(fix?.speedMps).toBeCloseTo(11.52, 2);
    expect(fix?.headingDeg).toBeCloseTo(84.4, 1);
  });

  it('reads an RMC position without accuracy', () => {
    const fix = parseNmea(RMC);
    expect(fix?.lat).toBeCloseTo(48.1173, 4);
    expect(fix?.accM).toBeUndefined();
  });

  it('ignores a GGA with fix quality 0 and an RMC with status V', () => {
    expect(parseNmea(GGA_NO_FIX)).toBeNull();
    expect(parseNmea(RMC_VOID)).toBeNull();
  });

  it('rejects a line with a wrong checksum', () => {
    expect(parseNmea(GGA.replace('*47', '*48'))).toBeNull();
  });

  it('ignores other sentences', () => {
    expect(parseNmea('$GPGSV,3,1,11,03,03,111,00*74')).toBeNull();
  });

  it('splits NMEA text into lines across chunks', () => {
    const r = new NmeaLineReader();
    expect(r.push('$GPGGA,1')).toEqual([]);
    expect(r.push('23\r\n$GP')).toEqual(['$GPGGA,123']);
    expect(r.push('RMC\n')).toEqual(['$GPRMC']);
  });

  it('keeps the GGA accuracy when an RMC follows', () => {
    const b = new NmeaFixBuilder();
    expect(b.line(GGA, 1000)?.accM).toBeCloseTo(4.5, 6);
    expect(b.line(RMC, 2000)).toEqual(expect.objectContaining({ accM: 4.5, at: 2000 }));
  });

  it('carries an RMC speed and course into the GGA fix that follows', () => {
    const b = new NmeaFixBuilder();
    b.line(sentence('GPRMC,123519,A,4807.038,N,01131.000,E,010.0,090.0,230394,003.1,W'), 1000);
    const fix = b.line(GGA, 1500);
    expect(fix?.speedMps).toBeCloseTo(5.14, 2);
    expect(fix?.headingDeg).toBe(90);
  });

  it('drops a carried speed and course after 2 s', () => {
    const b = new NmeaFixBuilder();
    b.line(sentence('GPRMC,123519,A,4807.038,N,01131.000,E,010.0,090.0,230394,003.1,W'), 1000);
    const fix = b.line(GGA, 4000);
    expect(fix?.speedMps).toBeUndefined();
    expect(fix?.headingDeg).toBeUndefined();
  });
});

/** A sentence with its checksum. */
function sentence(body: string): string {
  let x = 0;
  for (const ch of body) x ^= ch.charCodeAt(0);
  return `$${body}*${x.toString(16).toUpperCase().padStart(2, '0')}`;
}
