import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ContactInfoView } from '../components/ContactInfoView';
import type { Contact, ContactAnalytics } from '../types';

const { getContactAnalytics, contactTelemetryHistory, updateContactAnnotations } = vi.hoisted(
  () => ({
    getContactAnalytics: vi.fn(),
    contactTelemetryHistory: vi.fn(),
    updateContactAnnotations: vi.fn(),
  })
);

vi.mock('../api', () => ({
  api: {
    getContactAnalytics,
    contactTelemetryHistory,
    updateContactAnnotations,
  },
  isAbortError: () => false,
}));

vi.mock('../components/ContactAvatar', () => ({
  ContactAvatar: () => <div data-testid="contact-avatar" />,
}));

vi.mock('../components/ui/sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('../components/repeater/RepeaterDashboardBody', () => ({
  RepeaterDashboardBody: () => <div data-testid="repeater-body" />,
}));

vi.mock('../components/RoomServerPanel', () => ({
  RoomServerPanel: () => <div data-testid="room-panel" />,
}));

function createContact(overrides: Partial<Contact> = {}): Contact {
  return {
    public_key: 'AA'.repeat(32),
    name: 'Alice',
    type: 1,
    flags: 0,
    direct_path: null,
    direct_path_len: 0,
    direct_path_hash_mode: 0,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: 1700000000,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: 1699990000,
    ...overrides,
  };
}

function createAnalytics(contact: Contact | null): ContactAnalytics {
  return {
    lookup_type: 'contact',
    name: contact?.name ?? 'Mystery',
    contact,
    name_first_seen_at: null,
    name_history: [],
    dm_message_count: 0,
    channel_message_count: 0,
    includes_direct_messages: true,
    most_active_rooms: [],
    advert_paths: [],
    advert_frequency: null,
    nearest_repeaters: [],
    hourly_activity: [],
    weekly_activity: [],
  };
}

const baseHandlers = {
  onBack: vi.fn(),
  onToggleFavorite: vi.fn(),
};

describe('ContactInfoView', () => {
  beforeEach(() => {
    getContactAnalytics.mockReset();
    contactTelemetryHistory.mockReset();
    contactTelemetryHistory.mockResolvedValue([]);
    updateContactAnnotations.mockReset();
  });

  it('renders the contact name and no login region for a client', async () => {
    const contact = createContact();
    getContactAnalytics.mockResolvedValue(createAnalytics(contact));

    render(
      <ContactInfoView
        publicKey={contact.public_key}
        contacts={[contact]}
        config={null}
        {...baseHandlers}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Alice' })).toBeInTheDocument();
    });
    expect(screen.queryByTestId('repeater-body')).not.toBeInTheDocument();
    expect(screen.queryByTestId('room-panel')).not.toBeInTheDocument();
  });

  it('shows a minimizable login region for a repeater', async () => {
    const repeater = createContact({ type: 2, name: 'Rep' });
    getContactAnalytics.mockResolvedValue(createAnalytics(repeater));

    render(
      <ContactInfoView
        publicKey={repeater.public_key}
        contacts={[repeater]}
        config={null}
        {...baseHandlers}
      />
    );

    const toggle = await screen.findByRole('button', { name: /repeater login & dashboard/i });
    // Expanded by default: the dashboard body is visible.
    expect(screen.getByTestId('repeater-body')).toBeInTheDocument();

    await userEvent.click(toggle);
    // Minimized: body hidden, toggle remains.
    expect(screen.queryByTestId('repeater-body')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /repeater login & dashboard/i })).toBeInTheDocument();
  });

  it('shows the room server panel region for a room', async () => {
    const room = createContact({ type: 3, name: 'Room' });
    getContactAnalytics.mockResolvedValue(createAnalytics(room));

    render(
      <ContactInfoView
        publicKey={room.public_key}
        contacts={[room]}
        config={null}
        {...baseHandlers}
      />
    );

    await screen.findByRole('button', { name: /room login & tools/i });
    expect(screen.getByTestId('room-panel')).toBeInTheDocument();
  });
});
