import type {
  HandyApplyKind,
  HandyGroup,
  HandyInfoCustomEntry,
  HandyInfoOverride,
  HandyInfoSettings,
  HandyLinkCategory,
} from '../../types';

/** A built-in Handy Info entry, defined in code. */
export interface HandyBuiltin {
  id: string;
  group: HandyGroup;
  category?: HandyLinkCategory;
  /** i18n key for the default label (mutually exclusive with `label`). */
  labelKey?: string;
  /** Literal default label, used for brand names that are not translated. */
  label?: string;
  url: string;
  apply?: {
    kind: HandyApplyKind;
    node_url_template?: string;
    packet_url_template?: string;
    channel_url_template?: string;
  };
}

/** An entry after the user overlay is applied; what the section renders. */
export interface HandyEntry {
  id: string;
  source: 'builtin' | 'custom';
  group: HandyGroup;
  category?: string;
  /** i18n key for the label (built-ins with no override). */
  labelKey?: string;
  /** Literal label (custom entries, overridden built-ins, brand-name built-ins). */
  label?: string;
  url: string;
  apply?: {
    kind: HandyApplyKind;
    node_url_template?: string;
    packet_url_template?: string;
    channel_url_template?: string;
  };
}

export const HANDY_LINK_CATEGORIES: HandyLinkCategory[] = [
  'community',
  'monitoring',
  'tools',
  'technical',
  'fun',
];

/**
 * Built-in Handy Info entries. Ids are stable so the persisted overlay
 * (hide/edit) keeps working across releases and new built-ins appear
 * automatically for users who have customized.
 */
export const HANDY_BUILTINS: HandyBuiltin[] = [
  // --- Analyzers (apply-capable => Configure tab) ---
  {
    id: 'analyzer-cornmeister',
    group: 'analyzers',
    label: 'Cornmeister',
    url: 'https://cornmeister.nl',
    apply: {
      kind: 'analyzer',
      node_url_template: 'https://cornmeister.nl/#node?id={pubkey}',
      channel_url_template: 'https://cornmeister.nl/#channels?channel={name}',
    },
  },
  {
    id: 'analyzer-mc-radar',
    group: 'analyzers',
    label: 'MC-Radar',
    url: 'https://mc-radar.woodwar.com',
    apply: {
      kind: 'analyzer',
      node_url_template: 'https://mc-radar.woodwar.com/node/{pubkey}',
      channel_url_template: 'https://mc-radar.woodwar.com/group-messages?channel={name}',
    },
  },
  {
    id: 'analyzer-meshcore-analyzer-eu',
    group: 'analyzers',
    label: 'meshcore-analyzer.eu',
    url: 'https://meshcore-analyzer.eu',
    apply: {
      kind: 'analyzer',
      node_url_template: 'https://meshcore-analyzer.eu/#node?id={pubkey}',
      channel_url_template: 'https://meshcore-analyzer.eu/#channels?channel={name}',
    },
  },
  {
    id: 'analyzer-meshcorenetz',
    group: 'analyzers',
    label: 'MeshCoreNetz',
    url: 'https://analyzer.meshcorenetz.de',
    apply: {
      kind: 'analyzer',
      node_url_template: 'https://analyzer.meshcorenetz.de/#node?id={pubkey}',
      channel_url_template: 'https://analyzer.meshcorenetz.de/#channels?channel={name}',
    },
  },
  {
    id: 'analyzer-meshdresden',
    group: 'analyzers',
    label: 'MeshDresden',
    url: 'https://analyzer.meshdresden.eu',
    apply: {
      kind: 'analyzer',
      node_url_template: 'https://analyzer.meshdresden.eu/#node?id={pubkey}',
      channel_url_template: 'https://analyzer.meshdresden.eu/#channels?channel={name}',
    },
  },
  {
    id: 'analyzer-on8ar',
    group: 'analyzers',
    label: 'on8ar',
    url: 'https://analyzer.on8ar.eu',
    apply: {
      kind: 'analyzer',
      node_url_template: 'https://analyzer.on8ar.eu/#/nodes/{pubkey}',
      packet_url_template: 'https://analyzer.on8ar.eu/#/packets/{hash}',
      channel_url_template: 'https://analyzer.on8ar.eu/#/channels/{name}',
    },
  },
  // --- Sync sources (apply-capable => Configure tab) ---
  {
    id: 'sync-region',
    group: 'sync',
    labelKey: 'settings_handy_sync_region_label',
    url: 'https://meshcore-analyzer.eu/api/regions/scopes',
    apply: { kind: 'region_sync' },
  },
  {
    id: 'sync-registry',
    group: 'sync',
    labelKey: 'settings_handy_sync_registry_label',
    url: 'https://meshcore-analyzer.eu/api/channels',
    apply: { kind: 'registry_sync' },
  },
  // --- Community sites ---
  {
    id: 'link-meshcore-io',
    group: 'links',
    category: 'community',
    label: 'MeshCore.io',
    url: 'https://meshcore.io/',
  },
  {
    id: 'link-meshcore-nl',
    group: 'links',
    category: 'community',
    label: 'MeshCore.nl',
    url: 'https://www.meshcore.nl/',
  },
  {
    id: 'link-dutchmeshcore',
    group: 'links',
    category: 'community',
    label: 'DutchMeshCore',
    url: 'https://dutchmeshcore.nl/',
  },
  {
    id: 'link-meshwiki',
    group: 'links',
    category: 'community',
    label: 'MeshWiki',
    url: 'https://meshwiki.nl/',
  },
  {
    id: 'link-meshwiki-regions',
    group: 'links',
    category: 'community',
    labelKey: 'settings_handy_link_meshwiki_label',
    url: 'https://meshwiki.nl/wiki/Lijst_van_regio%27s',
  },
  // --- Monitoring / data ---
  {
    id: 'link-spamdetector',
    group: 'links',
    category: 'monitoring',
    label: 'MC Spamdetector',
    url: 'https://mc-spamdetector.nl/',
  },
  {
    id: 'link-meshwiki-analyser',
    group: 'links',
    category: 'monitoring',
    label: 'MeshWiki Analyser',
    url: 'https://analyser.meshwiki.nl/',
  },
  {
    id: 'link-observers',
    group: 'links',
    category: 'monitoring',
    label: 'DMC Observers',
    url: 'https://observers.dutchmeshcore.nl/',
  },
  // --- Tools ---
  {
    id: 'link-dutch-settings',
    group: 'links',
    category: 'tools',
    labelKey: 'settings_handy_link_dutch_settings_label',
    url: 'https://settings.dutchmeshcore.nl',
  },
  {
    id: 'link-channel-browser',
    group: 'links',
    category: 'tools',
    labelKey: 'settings_handy_link_channel_browser_label',
    url: 'https://toolbox.dutchmeshcore.nl/#/channel-browser',
  },
  {
    id: 'link-triangulator',
    group: 'links',
    category: 'tools',
    label: 'Triangulator',
    url: 'https://triangulator.dutchmeshcore.nl/',
  },
  {
    id: 'link-mesh-hunter',
    group: 'links',
    category: 'tools',
    label: 'Mesh-Hunter RX',
    url: 'https://rx.mesh-hunter.eu/',
  },
  // --- Technical ---
  {
    id: 'link-meshcore-spec',
    group: 'links',
    category: 'technical',
    label: 'MeshCore Spec',
    url: 'https://swaits.github.io/meshcore-spec/latest/00-overview.html',
  },
  // --- Fun ---
  {
    id: 'link-zweerbericht',
    group: 'links',
    category: 'fun',
    label: 'Zweerbericht',
    url: 'https://zweerbericht.nl/',
  },
];

export const EMPTY_HANDY_INFO: HandyInfoSettings = { overrides: {}, custom: [] };

/** Non-nullish coalesce that also treats `null` as "fall back to default". */
function pick<T>(override: T | null | undefined, fallback: T): T {
  return override === null || override === undefined ? fallback : override;
}

/** Apply the persisted overlay to the built-ins and append custom entries. */
export function resolveHandyEntries(
  builtins: HandyBuiltin[],
  handyInfo: HandyInfoSettings | null | undefined
): HandyEntry[] {
  const overrides = handyInfo?.overrides ?? {};
  const custom = handyInfo?.custom ?? [];
  const result: HandyEntry[] = [];

  for (const b of builtins) {
    const o = overrides[b.id];
    if (o?.hidden) continue;
    const overriddenLabel = o?.label ?? undefined;
    const apply = b.apply
      ? {
          kind: b.apply.kind,
          node_url_template: pick(o?.node_url_template, b.apply.node_url_template),
          packet_url_template: pick(o?.packet_url_template, b.apply.packet_url_template),
          channel_url_template: pick(o?.channel_url_template, b.apply.channel_url_template),
        }
      : undefined;
    result.push({
      id: b.id,
      source: 'builtin',
      group: b.group,
      category: pick(o?.category, b.category),
      labelKey: overriddenLabel ? undefined : b.labelKey,
      label: overriddenLabel ?? b.label,
      url: pick(o?.url, b.url),
      apply,
    });
  }

  for (const c of custom) {
    result.push({
      id: c.id,
      source: 'custom',
      group: c.group,
      category: c.category ?? undefined,
      label: c.label,
      url: c.url,
      apply: c.apply_kind
        ? {
            kind: c.apply_kind,
            node_url_template: c.node_url_template ?? undefined,
            packet_url_template: c.packet_url_template ?? undefined,
            channel_url_template: c.channel_url_template ?? undefined,
          }
        : undefined,
    });
  }

  return result;
}

/** Editable fields shared by the add/edit dialog. */
export interface HandyEntryForm {
  label: string;
  url: string;
  group: HandyGroup;
  category: HandyLinkCategory | '';
  applyKind: '' | HandyApplyKind;
  node_url_template: string;
  packet_url_template: string;
  channel_url_template: string;
}

/**
 * Build the minimal override for editing a built-in: only fields that differ
 * from the built-in default are stored, so reverting a field to the default
 * drops it. Returns null when nothing (and not hidden) needs to be stored.
 */
export function buildBuiltinOverride(
  builtin: HandyBuiltin,
  form: HandyEntryForm,
  existing: HandyInfoOverride | undefined,
  defaultLabel: string
): HandyInfoOverride | null {
  const next: HandyInfoOverride = {};
  if (existing?.hidden) next.hidden = true;

  if (form.label.trim() !== defaultLabel) next.label = form.label.trim();
  if (form.url.trim() !== builtin.url) next.url = form.url.trim();
  if (builtin.group === 'links' && form.category && form.category !== builtin.category) {
    next.category = form.category;
  }
  if (builtin.apply?.kind === 'analyzer') {
    const node = form.node_url_template.trim();
    if (node !== (builtin.apply.node_url_template ?? '')) next.node_url_template = node;
    const packet = form.packet_url_template.trim();
    if (packet !== (builtin.apply.packet_url_template ?? '')) {
      next.packet_url_template = packet || null;
    }
    const channel = form.channel_url_template.trim();
    if (channel !== (builtin.apply.channel_url_template ?? '')) {
      next.channel_url_template = channel || null;
    }
  }

  const hasValue =
    next.hidden === true ||
    next.label !== undefined ||
    next.url !== undefined ||
    next.category !== undefined ||
    next.node_url_template !== undefined ||
    next.packet_url_template !== undefined ||
    next.channel_url_template !== undefined;
  return hasValue ? next : null;
}

/** Turn dialog form state into a custom entry (id supplied by the caller). */
export function formToCustomEntry(id: string, form: HandyEntryForm): HandyInfoCustomEntry {
  const applyKind = form.group === 'links' ? null : form.applyKind || null;
  return {
    id,
    group: form.group,
    category: form.group === 'links' ? form.category || null : null,
    label: form.label.trim(),
    url: form.url.trim(),
    apply_kind: applyKind,
    node_url_template: applyKind === 'analyzer' ? form.node_url_template.trim() : null,
    packet_url_template:
      applyKind === 'analyzer' && form.packet_url_template.trim()
        ? form.packet_url_template.trim()
        : null,
    channel_url_template:
      applyKind === 'analyzer' && form.channel_url_template.trim()
        ? form.channel_url_template.trim()
        : null,
  };
}

/** Immutable helper: set (or clear when null) a built-in override. */
export function withOverride(
  overlay: HandyInfoSettings,
  id: string,
  override: HandyInfoOverride | null
): HandyInfoSettings {
  const overrides = { ...overlay.overrides };
  if (override === null) {
    delete overrides[id];
  } else {
    overrides[id] = override;
  }
  return { overrides, custom: overlay.custom };
}

/** Immutable helper: hide a built-in entry. */
export function withHiddenBuiltin(overlay: HandyInfoSettings, id: string): HandyInfoSettings {
  return withOverride(overlay, id, { ...overlay.overrides[id], hidden: true });
}

/** Immutable helper: insert or replace a custom entry (matched by id). */
export function withCustomEntry(
  overlay: HandyInfoSettings,
  entry: HandyInfoCustomEntry
): HandyInfoSettings {
  const idx = overlay.custom.findIndex((c) => c.id === entry.id);
  const custom =
    idx >= 0
      ? overlay.custom.map((c) => (c.id === entry.id ? entry : c))
      : [...overlay.custom, entry];
  return { overrides: overlay.overrides, custom };
}

/** Immutable helper: remove a custom entry by id. */
export function withoutCustomEntry(overlay: HandyInfoSettings, id: string): HandyInfoSettings {
  return { overrides: overlay.overrides, custom: overlay.custom.filter((c) => c.id !== id) };
}
