import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandPalette } from '../components/CommandPalette';
import { CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM, type Channel, type Contact } from '../types';

function makeContact(
  public_key: string,
  name: string,
  type = 1,
  overrides: Partial<Contact> = {}
): Contact {
  return {
    public_key,
    name,
    type,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: 0,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
    ...overrides,
  };
}

function renderPalette(contacts: Contact[], channels: Channel[] = []) {
  const onSelectConversation = vi.fn();
  render(
    <CommandPalette
      contacts={contacts}
      channels={channels}
      onSelectConversation={onSelectConversation}
      onOpenSettings={vi.fn()}
      onRepeaterAutoLogin={vi.fn()}
    />
  );
  // Palette is closed until Cmd/Ctrl+K.
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  return { onSelectConversation };
}

function group(heading: string): HTMLElement {
  const el = screen.getByText(heading).closest('[cmdk-group]');
  if (!el) throw new Error(`group "${heading}" not found`);
  return el as HTMLElement;
}

describe('CommandPalette room-server favorites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // cmdk calls scrollIntoView on mount; jsdom does not implement it.
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('renders a favorited room-server under "Favorite Room Servers" with a star', () => {
    const favRoom = makeContact('33'.repeat(32), 'Ops Board', CONTACT_TYPE_ROOM, {
      favorite: true,
    });
    renderPalette([favRoom]);

    const favGroup = group('Favorite Room Servers');
    within(favGroup).getByText('Ops Board');
    expect(favGroup.querySelector('.text-favorite')).not.toBeNull();

    // A favorited room must not also appear in the plain "Rooms" group.
    expect(screen.queryByText('Rooms')).toBeNull();
  });

  it('renders a non-favorited room-server under "Rooms" with no favorite group and no star', () => {
    const plainRoom = makeContact('44'.repeat(32), 'Town Square', CONTACT_TYPE_ROOM);
    renderPalette([plainRoom]);

    const roomsGroup = group('Rooms');
    within(roomsGroup).getByText('Town Square');
    expect(roomsGroup.querySelector('.text-favorite')).toBeNull();
    expect(screen.queryByText('Favorite Room Servers')).toBeNull();
  });

  it('separates favorited and non-favorited rooms into their own groups', () => {
    const favRoom = makeContact('33'.repeat(32), 'Ops Board', CONTACT_TYPE_ROOM, {
      favorite: true,
    });
    const plainRoom = makeContact('44'.repeat(32), 'Town Square', CONTACT_TYPE_ROOM);
    const favRepeater = makeContact('22'.repeat(32), 'Relay', CONTACT_TYPE_REPEATER, {
      favorite: true,
    });
    renderPalette([favRoom, plainRoom, favRepeater]);

    within(group('Favorite Room Servers')).getByText('Ops Board');
    within(group('Rooms')).getByText('Town Square');
    // Existing repeater favorite grouping is unaffected. RepeaterGroup renders a
    // name row plus an "(ACL login + load all)" row, so the name appears twice.
    expect(within(group('Favorite Repeaters')).getAllByText('Relay').length).toBeGreaterThan(0);
  });
});
