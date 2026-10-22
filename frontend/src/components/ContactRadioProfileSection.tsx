import { useEffect, useState } from 'react';

import { api } from '../api';
import { useT } from '../i18n';
import type { RadioStamp } from '../types';
import { parseRadioFields } from '../utils/radioSf';
import {
  setContactProfile,
  setTempRadioState,
  useContactProfile,
  useContactSightings,
  useTempRadioState,
  useTempRadioSupported,
} from '../utils/tempRadio';
import { RadioSfPills } from './RadioSfPill';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { toast } from './ui/sonner';

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-ring';

/**
 * A contact's radio settings (spec 4.6): every settings set it was heard on,
 * and the settings saved for it, used by the DM header switch button and by
 * auto switch before each DM.
 */
export function ContactRadioProfileSection({ publicKey }: { publicKey: string }) {
  const t = useT();
  const sightings = useContactSightings(publicKey);
  const profile = useContactProfile(publicKey);
  const session = useTempRadioState();
  const supported = useTempRadioSupported();

  const [freq, setFreq] = useState('');
  const [bw, setBw] = useState('');
  const [sf, setSf] = useState('');
  const [cr, setCr] = useState('');
  const [region, setRegion] = useState('');
  const [duration, setDuration] = useState('30');
  const [unit, setUnit] = useState<'minutes' | 'hours'>('minutes');
  const [autoSwitch, setAutoSwitch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fill = (stamp: RadioStamp) => {
    setFreq(String(stamp.freq));
    setBw(String(stamp.bw));
    setSf(String(stamp.sf));
    setCr(String(stamp.cr));
  };

  // Load the saved settings when the contact (or its saved profile) changes.
  useEffect(() => {
    if (profile) {
      fill(profile.radio);
      setRegion(profile.region ? profile.region.replace(/^#/, '') : '');
      const hours = profile.duration_secs % 3600 === 0;
      setUnit(hours ? 'hours' : 'minutes');
      setDuration(String(hours ? profile.duration_secs / 3600 : profile.duration_secs / 60));
      setAutoSwitch(profile.auto_switch);
    } else {
      setFreq('');
      setBw('');
      setSf('');
      setCr('');
      setRegion('');
      setDuration('30');
      setUnit('minutes');
      setAutoSwitch(false);
    }
    setError(null);
  }, [profile]);

  const save = async () => {
    const parsed = parseRadioFields({ freq, bw, sf, cr });
    if (parsed.error) {
      setError(t(parsed.error));
      return;
    }
    const amount = Number(duration);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('temp_radio_error_duration'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const trimmed = region.trim();
      const saved = await api.putContactRadioProfile(publicKey, {
        radio: parsed.stamp,
        region: trimmed.length > 0 ? trimmed : null,
        duration_secs: Math.round(amount * (unit === 'hours' ? 3600 : 60)),
        auto_switch: autoSwitch,
      });
      setContactProfile(publicKey, saved);
      toast.success(t('contact_radio_saved'));
    } catch (err) {
      setError(
        t('contact_radio_save_failed', { error: err instanceof Error ? err.message : String(err) })
      );
    } finally {
      setBusy(false);
    }
  };

  const switchNow = async () => {
    setBusy(true);
    setError(null);
    try {
      setTempRadioState(await api.switchToContactRadioProfile(publicKey));
    } catch (err) {
      setError(t('temp_radio_failed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteContactRadioProfile(publicKey);
      setContactProfile(publicKey, null);
    } catch (err) {
      setError(
        t('contact_radio_save_failed', { error: err instanceof Error ? err.message : String(err) })
      );
    } finally {
      setBusy(false);
    }
  };

  const distinct: RadioStamp[] = [];
  for (const s of sightings) {
    if (
      !distinct.some((d) => d.sf === s.sf && d.freq === s.freq && d.bw === s.bw && d.cr === s.cr)
    ) {
      distinct.push({ freq: s.freq, bw: s.bw, sf: s.sf, cr: s.cr });
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs text-muted-foreground">{t('contact_radio_heard_on')}</div>
        {distinct.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('contact_radio_heard_on_none')}</p>
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <RadioSfPills stamps={distinct} className="ml-0" />
            {distinct.map((stamp) => (
              <Button
                key={`${stamp.sf}-${stamp.freq}-${stamp.bw}-${stamp.cr}`}
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={() => fill(stamp)}
              >
                {t('contact_radio_use_sighting', { sf: stamp.sf })}
              </Button>
            ))}
          </div>
        )}
        {session.active && session.temp && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-1 h-6 px-2 text-xs"
            onClick={() => session.temp && fill(session.temp)}
          >
            {t('contact_radio_use_session')}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{t('contact_radio_hint')}</p>
      {!supported && <p className="text-xs text-warning">{t('contact_radio_openhop_note')}</p>}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="contact-radio-freq">{t('temp_radio_freq_label')}</Label>
          <Input id="contact-radio-freq" value={freq} onChange={(e) => setFreq(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="contact-radio-bw">{t('temp_radio_bw_label')}</Label>
          <Input id="contact-radio-bw" value={bw} onChange={(e) => setBw(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="contact-radio-sf">{t('temp_radio_sf_label')}</Label>
          <Input id="contact-radio-sf" value={sf} onChange={(e) => setSf(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="contact-radio-cr">{t('temp_radio_cr_label')}</Label>
          <Input id="contact-radio-cr" value={cr} onChange={(e) => setCr(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="contact-radio-region">{t('temp_radio_region_label')}</Label>
          <Input
            id="contact-radio-region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="contact-radio-duration">{t('temp_radio_duration_label')}</Label>
          <div className="flex gap-1">
            <Input
              id="contact-radio-duration"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
            <select
              aria-label={t('temp_radio_duration_unit_label')}
              className={SELECT_CLASS}
              value={unit}
              onChange={(e) => setUnit(e.target.value as 'minutes' | 'hours')}
            >
              <option value="minutes">{t('temp_radio_unit_minutes')}</option>
              <option value="hours">{t('temp_radio_unit_hours')}</option>
            </select>
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={autoSwitch}
          onChange={(e) => setAutoSwitch(e.target.checked)}
        />
        {t('contact_radio_auto_switch')}
      </label>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={save}>
          {t('contact_radio_save')}
        </Button>
        {profile && supported && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={switchNow}>
            {t('contact_radio_switch_now')}
          </Button>
        )}
        {profile && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={remove}>
            {t('contact_radio_remove')}
          </Button>
        )}
      </div>
    </div>
  );
}
