import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ContactInfoPane } from '../components/ContactInfoPane';
import type { AnalyzerSite, Contact, PartialNodeResolution } from '../types';

const {
  getContactAnalytics,
  contactTelemetryHistory,
  listPartialResolutions,
  deletePartialResolution,
} = vi.hoisted(() => ({
  getContactAnalytics: vi.fn(),
  contactTelemetryHistory: vi.fn(),
  listPartialResolutions: vi.fn(),
  deletePartialResolution: vi.fn(),
}));

vi.mock('../api', () => ({
  api: {
    getContactAnalytics,
    contactTelemetryHistory,
    listPartialResolutions,
    deletePartialResolution,
  },
  isAbortError: () => false,
}));

vi.mock('../components/ui/sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../components/ContactAvatar', () => ({
  ContactAvatar: () => <div data-testid="contact-avatar" />,
}));

vi.mock('../components/ui/sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const RESOLVED_PK = 'aa' + '11'.repeat(31);

const prefixContact: Contact = {
  public_key: 'aa',
  name: null,
  type: 0,
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
};

const resolution: PartialNodeResolution = {
  prefix_hex: 'aa',
  resolved_pubkey: RESOLVED_PK,
  resolved_name: 'Alpha Repeater',
  source: 'external_map',
  confidence: 0.8,
  candidate_count: 1,
  resolved_by: 'user',
  created_at: null,
  updated_at: null,
};

const analyzerSites: AnalyzerSite[] = [
  { name: 'EU Analyzer', node_url_template: 'https://analyzer.example/node/{pubkey}' },
];

function renderPane(sites: AnalyzerSite[] = []) {
  return render(
    <ContactInfoPane
      contactKey="aa"
      onClose={() => {}}
      contacts={[prefixContact]}
      config={null}
      onToggleFavorite={() => {}}
      analyzerSites={sites}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getContactAnalytics.mockResolvedValue(null);
  contactTelemetryHistory.mockResolvedValue([]);
  listPartialResolutions.mockResolvedValue([resolution]);
  deletePartialResolution.mockResolvedValue({ deleted: true });
});

describe('ContactInfoPane partial-node soft resolution', () => {
  it('shows the soft-resolved node for a prefix-only contact', async () => {
    renderPane();
    expect(await screen.findByText('Alpha Repeater')).toBeInTheDocument();
  });

  it('offers the analyzer lookup for a prefix-only contact once soft-resolved', async () => {
    renderPane(analyzerSites);
    expect(await screen.findByText(/EU Analyzer/)).toBeInTheDocument();
  });

  it('clears the soft resolution', async () => {
    const user = userEvent.setup();
    renderPane();
    await screen.findByText('Alpha Repeater');

    await user.click(screen.getByRole('button', { name: 'Clear resolution' }));

    await waitFor(() => expect(deletePartialResolution).toHaveBeenCalledWith('aa'));
  });
});
