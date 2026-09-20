import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ContactStatusInfo } from '../components/ContactStatusInfo';
import { I18nProvider } from '../i18n/I18nProvider';
import type { Contact } from '../types';
import { CONTACT_TYPE_REPEATER } from '../types';

function makeContact(overrides: Partial<Contact>): Contact {
  return {
    public_key: 'ab'.repeat(32),
    name: 'Node',
    type: CONTACT_TYPE_REPEATER,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: -1,
    route_override_path: null,
    route_override_len: null,
    route_override_hash_mode: null,
    last_advert: null,
    lat: null,
    lon: null,
    manual_lat: null,
    manual_lon: null,
    last_seen: 1_700_000_000,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
    ...overrides,
  };
}

function renderStatus(contact: Contact) {
  return render(
    <I18nProvider>
      <ContactStatusInfo contact={contact} ourLat={null} ourLon={null} />
    </I18nProvider>
  );
}

describe('ContactStatusInfo location', () => {
  it('shows the manual override coordinates when the node has no advertised location', () => {
    renderStatus(makeContact({ lat: null, lon: null, manual_lat: 51.5, manual_lon: 4.25 }));
    expect(screen.getByText('51.500, 4.250')).toBeInTheDocument();
  });

  it('shows the advertised coordinates when both advertised and manual exist', () => {
    renderStatus(makeContact({ lat: 52.1, lon: 5.3, manual_lat: 10, manual_lon: 10 }));
    expect(screen.getByText('52.100, 5.300')).toBeInTheDocument();
    expect(screen.queryByText('10.000, 10.000')).not.toBeInTheDocument();
  });

  it('shows no coordinate line when the node has neither advertised nor manual location', () => {
    const { container } = renderStatus(makeContact({ lat: null, lon: null }));
    expect(container.textContent).not.toMatch(/\d+\.\d{3}, /);
  });
});
