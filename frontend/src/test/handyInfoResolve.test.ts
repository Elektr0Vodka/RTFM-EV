import { describe, expect, it } from 'vitest';

import {
  buildBuiltinOverride,
  formToCustomEntry,
  resolveHandyEntries,
  withCustomEntry,
  withHiddenBuiltin,
  withKnowledgeBase,
  withoutCustomEntry,
  type HandyBuiltin,
  type HandyEntryForm,
} from '../components/settings/handyInfo';

const BUILTINS: HandyBuiltin[] = [
  {
    id: 'analyzer-x',
    group: 'analyzers',
    label: 'X',
    url: 'https://x.example',
    apply: { kind: 'analyzer', node_url_template: 'https://x.example/{pubkey}' },
  },
  { id: 'link-y', group: 'links', category: 'tools', label: 'Y', url: 'https://y.example' },
];

const baseForm: HandyEntryForm = {
  label: '',
  url: '',
  group: 'links',
  category: 'community',
  applyKind: '',
  node_url_template: '',
  packet_url_template: '',
  channel_url_template: '',
  node_api_url_template: '',
};

describe('resolveHandyEntries', () => {
  it('returns built-ins unchanged with an empty overlay', () => {
    const entries = resolveHandyEntries(BUILTINS, { overrides: {}, custom: [] });
    expect(entries.map((e) => e.id)).toEqual(['analyzer-x', 'link-y']);
    expect(entries[0].apply?.node_url_template).toBe('https://x.example/{pubkey}');
  });

  it('omits hidden built-ins', () => {
    const entries = resolveHandyEntries(BUILTINS, {
      overrides: { 'link-y': { hidden: true } },
      custom: [],
    });
    expect(entries.map((e) => e.id)).toEqual(['analyzer-x']);
  });

  it('applies field overrides and keeps defaults for unset fields', () => {
    const entries = resolveHandyEntries(BUILTINS, {
      overrides: { 'link-y': { label: 'Renamed', url: null } },
      custom: [],
    });
    const y = entries.find((e) => e.id === 'link-y')!;
    expect(y.label).toBe('Renamed');
    expect(y.labelKey).toBeUndefined();
    expect(y.url).toBe('https://y.example');
  });

  it('carries the analyzer channel_url_template from a built-in', () => {
    const builtins: HandyBuiltin[] = [
      {
        id: 'analyzer-z',
        group: 'analyzers',
        label: 'Z',
        url: 'https://z.example',
        apply: {
          kind: 'analyzer',
          node_url_template: 'https://z.example/{pubkey}',
          channel_url_template: 'https://z.example/#channels?channel={name}',
        },
      },
    ];
    const entries = resolveHandyEntries(builtins, { overrides: {}, custom: [] });
    expect(entries[0].apply?.channel_url_template).toBe(
      'https://z.example/#channels?channel={name}'
    );
  });

  it('overrides the analyzer channel_url_template', () => {
    const builtins: HandyBuiltin[] = [
      {
        id: 'analyzer-z',
        group: 'analyzers',
        label: 'Z',
        url: 'https://z.example',
        apply: {
          kind: 'analyzer',
          node_url_template: 'https://z.example/{pubkey}',
          channel_url_template: 'https://z.example/#channels?channel={name}',
        },
      },
    ];
    const entries = resolveHandyEntries(builtins, {
      overrides: { 'analyzer-z': { channel_url_template: 'https://z.example/ch/{channel}' } },
      custom: [],
    });
    expect(entries[0].apply?.channel_url_template).toBe('https://z.example/ch/{channel}');
  });

  it('appends custom entries after built-ins', () => {
    const entries = resolveHandyEntries(BUILTINS, {
      overrides: {},
      custom: [
        { id: 'c1', group: 'links', category: 'fun', label: 'Fun', url: 'https://f.example' },
      ],
    });
    expect(entries.map((e) => e.id)).toEqual(['analyzer-x', 'link-y', 'c1']);
    expect(entries[2].source).toBe('custom');
  });
});

describe('buildBuiltinOverride', () => {
  const analyzer = BUILTINS[0];

  it('stores only changed fields', () => {
    const form = {
      ...baseForm,
      group: 'analyzers' as const,
      label: 'X',
      url: 'https://x.example',
      node_url_template: 'https://x.example/new/{pubkey}',
    };
    const override = buildBuiltinOverride(analyzer, form, undefined, 'X');
    expect(override).toEqual({ node_url_template: 'https://x.example/new/{pubkey}' });
  });

  it('returns null when nothing differs from the default', () => {
    const form = {
      ...baseForm,
      group: 'analyzers' as const,
      label: 'X',
      url: 'https://x.example',
      node_url_template: 'https://x.example/{pubkey}',
    };
    expect(buildBuiltinOverride(analyzer, form, undefined, 'X')).toBeNull();
  });

  it('stores a changed channel_url_template', () => {
    const analyzerZ: HandyBuiltin = {
      id: 'analyzer-z',
      group: 'analyzers',
      label: 'Z',
      url: 'https://z.example',
      apply: {
        kind: 'analyzer',
        node_url_template: 'https://z.example/{pubkey}',
        channel_url_template: 'https://z.example/ch/{name}',
      },
    };
    const form = {
      ...baseForm,
      group: 'analyzers' as const,
      label: 'Z',
      url: 'https://z.example',
      node_url_template: 'https://z.example/{pubkey}',
      channel_url_template: 'https://z.example/#channels?channel={name}',
    };
    expect(buildBuiltinOverride(analyzerZ, form, undefined, 'Z')).toEqual({
      channel_url_template: 'https://z.example/#channels?channel={name}',
    });
  });

  it('preserves an existing hidden flag', () => {
    const form = {
      ...baseForm,
      group: 'analyzers' as const,
      label: 'X',
      url: 'https://x.example',
      node_url_template: 'https://x.example/{pubkey}',
    };
    const override = buildBuiltinOverride(analyzer, form, { hidden: true }, 'X');
    expect(override).toEqual({ hidden: true });
  });
});

describe('formToCustomEntry', () => {
  it('builds a link entry with no apply kind', () => {
    const form = {
      ...baseForm,
      group: 'links' as const,
      category: 'tools' as const,
      label: '  T  ',
      url: '  https://t.example  ',
    };
    expect(formToCustomEntry('id1', form)).toEqual({
      id: 'id1',
      group: 'links',
      category: 'tools',
      label: 'T',
      url: 'https://t.example',
      apply_kind: null,
      node_url_template: null,
      packet_url_template: null,
      channel_url_template: null,
      node_api_url_template: null,
    });
  });

  it('builds an analyzer entry with templates', () => {
    const form = {
      ...baseForm,
      group: 'analyzers' as const,
      applyKind: 'analyzer' as const,
      label: 'A',
      url: 'https://a.example',
      node_url_template: 'https://a.example/{pubkey}',
      packet_url_template: 'https://a.example/{hash}',
    };
    expect(formToCustomEntry('id2', form)).toMatchObject({
      group: 'analyzers',
      apply_kind: 'analyzer',
      node_url_template: 'https://a.example/{pubkey}',
      packet_url_template: 'https://a.example/{hash}',
      category: null,
    });
  });

  it('includes channel_url_template for an analyzer entry', () => {
    const form = {
      ...baseForm,
      group: 'analyzers' as const,
      applyKind: 'analyzer' as const,
      label: 'A',
      url: 'https://a.example',
      node_url_template: 'https://a.example/{pubkey}',
      channel_url_template: 'https://a.example/#channels?channel={name}',
    };
    expect(formToCustomEntry('id3', form)).toMatchObject({
      channel_url_template: 'https://a.example/#channels?channel={name}',
    });
  });

  it('nulls an empty channel_url_template for an analyzer entry', () => {
    const form = {
      ...baseForm,
      group: 'analyzers' as const,
      applyKind: 'analyzer' as const,
      label: 'A',
      url: 'https://a.example',
      node_url_template: 'https://a.example/{pubkey}',
    };
    expect(formToCustomEntry('id4', form)).toMatchObject({ channel_url_template: null });
  });
});

describe('overlay mutation helpers', () => {
  it('hides, adds, and removes without mutating the input', () => {
    const overlay = { overrides: {}, custom: [] };
    const hidden = withHiddenBuiltin(overlay, 'link-y');
    expect(hidden.overrides['link-y']).toEqual({ hidden: true });
    expect(overlay.overrides).toEqual({});

    const entry = {
      id: 'c1',
      group: 'links' as const,
      category: 'fun',
      label: 'F',
      url: 'https://f.example',
    };
    const added = withCustomEntry(overlay, entry);
    expect(added.custom).toHaveLength(1);

    const removed = withoutCustomEntry(added, 'c1');
    expect(removed.custom).toHaveLength(0);
  });
});

describe('knowledge base flag', () => {
  const customLink = {
    id: 'c1',
    group: 'links' as const,
    category: 'fun',
    label: 'C',
    url: 'https://c.example',
  };

  it('defaults built-ins and custom links to not-in-KB', () => {
    const entries = resolveHandyEntries(BUILTINS, { overrides: {}, custom: [customLink] });
    expect(entries.map((e) => e.kb)).toEqual([false, false, false]);
  });

  it('reads the flag from overrides and custom entries', () => {
    const entries = resolveHandyEntries(BUILTINS, {
      overrides: { 'link-y': { kb: true } },
      custom: [{ ...customLink, kb: true }],
    });
    expect(entries.find((e) => e.id === 'link-y')?.kb).toBe(true);
    expect(entries.find((e) => e.id === 'c1')?.kb).toBe(true);
  });

  it('keeps an existing kb flag when a built-in is edited', () => {
    const form = {
      ...baseForm,
      category: 'tools' as const,
      label: 'Y2',
      url: 'https://y.example',
    };
    expect(buildBuiltinOverride(BUILTINS[1], form, { kb: true }, 'Y')).toEqual({
      kb: true,
      label: 'Y2',
    });
    const unchanged = { ...form, label: 'Y' };
    expect(buildBuiltinOverride(BUILTINS[1], unchanged, { kb: true }, 'Y')).toEqual({ kb: true });
  });

  it('formToCustomEntry sets kb only for links', () => {
    const link = { ...baseForm, label: 'L', url: 'https://l.example' };
    expect(formToCustomEntry('l1', link, true).kb).toBe(true);
    expect(formToCustomEntry('l1', link).kb).toBeUndefined();
    const analyzer = {
      ...baseForm,
      group: 'analyzers' as const,
      applyKind: 'analyzer' as const,
      label: 'A',
      url: 'https://a.example',
      node_url_template: 'https://a.example/{pubkey}',
    };
    expect(formToCustomEntry('a1', analyzer, true).kb).toBeUndefined();
  });

  it('withKnowledgeBase flags and unflags a built-in, dropping an empty override', () => {
    const empty = { overrides: {}, custom: [] };
    const on = withKnowledgeBase(empty, { id: 'link-y', source: 'builtin' }, true);
    expect(on.overrides['link-y']).toEqual({ kb: true });
    const off = withKnowledgeBase(on, { id: 'link-y', source: 'builtin' }, false);
    expect(off.overrides['link-y']).toBeUndefined();

    const edited = { overrides: { 'link-y': { label: 'Mine', kb: true } }, custom: [] };
    const offEdited = withKnowledgeBase(edited, { id: 'link-y', source: 'builtin' }, false);
    expect(offEdited.overrides['link-y']).toEqual({ label: 'Mine' });
  });

  it('withKnowledgeBase toggles a custom entry without mutating the input', () => {
    const overlay = { overrides: {}, custom: [customLink] };
    const on = withKnowledgeBase(overlay, { id: 'c1', source: 'custom' }, true);
    expect(on.custom[0].kb).toBe(true);
    expect(overlay.custom[0]).not.toHaveProperty('kb');
    const off = withKnowledgeBase(on, { id: 'c1', source: 'custom' }, false);
    expect(off.custom[0].kb).toBe(false);
  });
});
