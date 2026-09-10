import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
  Edit2,
  Hash,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import {
  addManualChannel,
  addMissingFromSync,
  applyChannelStats,
  loadRegistry,
  mergeImport,
  recordFinderDiscovery,
  saveRegistry,
  seedFromRadioChannels,
  toProjectAFormat,
  updateChannel,
  type ChannelBulkStats,
  type RegistryChannel,
} from '../lib/channelManager';
import { api } from '../api';
import { buildAutoFillFromGeo, isVeiligheidsregio, matchDutchChannel } from '../lib/dutchGeo';
import type { Channel } from '../types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type SortField =
  | 'channel'
  | 'category'
  | 'status'
  | 'source'
  | 'lastHeard'
  | 'packets'
  | 'added'
  | 'country'
  | 'region';
type SortDir = 'asc' | 'desc';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDatetime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return d.toLocaleDateString();
}

function sourceBadge(source: RegistryChannel['source']) {
  const styles: Record<RegistryChannel['source'], string> = {
    finder: 'bg-primary/10 text-primary',
    manual: 'bg-muted text-muted-foreground',
    imported: 'bg-muted text-muted-foreground',
    radio: 'bg-blue-500/10 text-blue-600',
  };
  return (
    <span
      className={cn(
        'text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded',
        styles[source]
      )}
      data-source={source}
    >
      {source}
    </span>
  );
}

function statusBadge(status: RegistryChannel['status']) {
  const styles: Record<RegistryChannel['status'], string> = {
    active: 'bg-green-500/10 text-green-600',
    inactive: 'bg-muted text-muted-foreground',
    dormant: 'bg-yellow-500/10 text-yellow-600',
    experimental: 'bg-blue-500/10 text-blue-600',
  };
  return (
    <span
      className={cn(
        'text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded',
        styles[status]
      )}
      data-status={status}
    >
      {status}
    </span>
  );
}

function triggerDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCSV(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Merge geo scopes into an existing comma-separated scopes string.
 * Existing scopes are preserved; only geo scopes not already present are appended.
 */
function mergeScopes(existingCsv: string, geoScopes: string[]): string {
  const existing = parseCSV(existingCsv);
  const existingLower = new Set(existing.map((s) => s.toLowerCase()));
  const toAdd = geoScopes.filter((s) => !existingLower.has(s.toLowerCase()));
  return [...existing, ...toAdd].join(', ');
}

// ── Sort logic ────────────────────────────────────────────────────────────────

function sortRegistry(arr: RegistryChannel[], field: SortField, dir: SortDir): RegistryChannel[] {
  const d = dir === 'asc' ? 1 : -1;
  return [...arr].sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case 'channel':
        cmp = a.channel.localeCompare(b.channel, undefined, { sensitivity: 'base' });
        break;
      case 'category':
        cmp = (a.category || '').localeCompare(b.category || '', undefined, {
          sensitivity: 'base',
        });
        break;
      case 'status':
        cmp = a.status.localeCompare(b.status);
        break;
      case 'source':
        cmp = a.source.localeCompare(b.source);
        break;
      case 'lastHeard':
        cmp = (a.lastHeard || '').localeCompare(b.lastHeard || '');
        break;
      case 'packets':
        cmp = (a.packets ?? 0) - (b.packets ?? 0);
        break;
      case 'added':
        cmp = (a.added || '').localeCompare(b.added || '');
        break;
      case 'country':
        cmp = (a.country || '').localeCompare(b.country || '', undefined, { sensitivity: 'base' });
        break;
      case 'region':
        cmp = (a.region || '').localeCompare(b.region || '', undefined, { sensitivity: 'base' });
        break;
    }
    return cmp !== 0 ? d * cmp : a.channel.localeCompare(b.channel);
  });
}

// ── Sort header component ─────────────────────────────────────────────────────

function SortHeader({
  label,
  field,
  sortField,
  sortDir,
  onSort,
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <button
      className={cn(
        'flex items-center gap-0.5 text-[0.625rem] uppercase tracking-wider font-medium hover:text-foreground transition-colors select-none',
        active ? 'text-foreground' : 'text-muted-foreground'
      )}
      onClick={() => onSort(field)}
    >
      {label}
      {active ? (
        sortDir === 'asc' ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )
      ) : (
        <ChevronsUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

// ── Edit modal ────────────────────────────────────────────────────────────────

interface EditFormState {
  category: string;
  subcategory: string;
  country: string;
  region: string;
  language: string;
  scopes: string;
  tags: string;
  notes: string;
  status: RegistryChannel['status'];
  source: RegistryChannel['source'];
  alias_of: string;
  verified: boolean;
  recommended: boolean;
  private: boolean;
  lastHeard: string;
  added: string;
}

function channelToEditForm(e: RegistryChannel): EditFormState {
  return {
    category: e.category,
    subcategory: e.subcategory,
    country: e.country,
    region: e.region,
    language: e.language.join(', '),
    scopes: e.scopes.join(', '),
    tags: e.tags.join(', '),
    notes: e.notes,
    status: e.status,
    source: e.source,
    alias_of: e.alias_of ?? '',
    verified: e.verified,
    recommended: e.recommended,
    private: e.private ?? false,
    lastHeard: e.lastHeard ? e.lastHeard.slice(0, 10) : '',
    added: e.added ?? '',
  };
}

function EditChannelModal({
  channel,
  categoryMap,
  onSave,
  onClose,
}: {
  channel: RegistryChannel;
  categoryMap: Map<string, Set<string>>;
  onSave: (patch: Partial<RegistryChannel>) => void;
  onClose: () => void;
}) {
  const catListId = useId();
  const subListId = useId();
  const [form, setForm] = useState<EditFormState>(() => channelToEditForm(channel));

  // Dutch geo auto-fill: detect if channel name maps to a known Dutch location
  const geoMatch = useMemo(() => matchDutchChannel(channel.channel), [channel.channel]);
  const geoFill = useMemo(() => (geoMatch ? buildAutoFillFromGeo(geoMatch) : null), [geoMatch]);

  function applyGeoFill() {
    if (!geoFill) return;
    setForm((f) => ({
      ...f,
      country: geoFill.country,
      region: geoFill.region,
      language: f.language || 'NL',
      category: f.category || geoFill.category,
      subcategory: f.subcategory || geoFill.subcategory,
      // Merge scopes: keep existing ones, add new geo scopes that aren't already present
      scopes: mergeScopes(f.scopes, geoFill.scopes),
    }));
  }

  const subOptions = useMemo(() => {
    const key = form.category.trim().toLowerCase();
    const subs = categoryMap.get(key);
    return subs ? [...subs].sort() : [];
  }, [form.category, categoryMap]);

  function handleSave() {
    const patch: Partial<RegistryChannel> = {
      category: form.category.trim(),
      subcategory: form.subcategory.trim(),
      country: form.country.trim(),
      region: form.region.trim(),
      language: parseCSV(form.language.toUpperCase()),
      scopes: parseCSV(form.scopes),
      tags: parseCSV(form.tags),
      notes: form.notes.trim(),
      status: form.status,
      source: form.source,
      alias_of: form.alias_of.trim() || null,
      verified: form.verified,
      recommended: form.recommended,
      private: form.private,
      added: form.added || null,
    };
    if (form.lastHeard) {
      // Preserve time component if it exists, otherwise use noon UTC to avoid TZ shift
      const existing = channel.lastHeard;
      if (existing && existing.slice(0, 10) === form.lastHeard) {
        patch.lastHeard = existing;
      } else {
        patch.lastHeard = `${form.lastHeard}T12:00:00.000Z`;
      }
    }
    onSave(patch);
    onClose();
  }

  const inputCls = 'h-7 text-sm';
  const labelCls = 'text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hash className="h-4 w-4" />
            {channel.channel}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Dutch geo auto-fill banner */}
          {geoFill && (
            <div className="flex items-center justify-between gap-2 rounded border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-lg leading-none">🇳🇱</span>
                <span className="text-muted-foreground">
                  Detected <span className="font-medium text-foreground">{geoMatch?.name}</span>
                  {' — '}
                  <span className="font-medium text-foreground">{geoFill.region}</span>
                  {', '}
                  <span className="text-orange-600 dark:text-orange-400 font-medium">
                    VR {geoMatch?.veiligheidsregio}
                  </span>
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px] px-2 shrink-0"
                onClick={applyGeoFill}
              >
                Auto-fill
              </Button>
            </div>
          )}

          {/* Category + Subcategory */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className={labelCls}>Category</Label>
              <Input
                list={catListId}
                className={inputCls}
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="e.g. Regional"
              />
              <datalist id={catListId}>
                {[...categoryMap.keys()].sort().map((k) => (
                  <option key={k} value={k.charAt(0).toUpperCase() + k.slice(1)} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label className={labelCls}>Subcategory</Label>
              <Input
                list={subListId}
                className={inputCls}
                value={form.subcategory}
                onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))}
                placeholder="e.g. City"
              />
              <datalist id={subListId}>
                {subOptions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Country + Region */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className={labelCls}>Country</Label>
              <Input
                className={inputCls}
                value={form.country}
                onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                placeholder="e.g. Netherlands"
              />
            </div>
            <div className="space-y-1">
              <Label className={labelCls}>Region</Label>
              <Input
                className={inputCls}
                value={form.region}
                onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                placeholder="e.g. Noord-Holland"
              />
            </div>
          </div>

          {/* Language + Status + Source */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className={labelCls}>Language</Label>
              <Input
                className={inputCls}
                value={form.language}
                onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                placeholder="NL, EN"
              />
              <p className="text-[0.625rem] text-muted-foreground">Comma-separated</p>
            </div>
            <div className="space-y-1">
              <Label className={labelCls}>Status</Label>
              <select
                className="h-7 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value as RegistryChannel['status'] }))
                }
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="dormant">Dormant</option>
                <option value="experimental">Experimental</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className={labelCls}>Source</Label>
              <select
                className="h-7 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={form.source}
                onChange={(e) =>
                  setForm((f) => ({ ...f, source: e.target.value as RegistryChannel['source'] }))
                }
              >
                <option value="manual">User</option>
                <option value="imported">Imported</option>
                <option value="radio">Radio</option>
                <option value="finder">Finder</option>
              </select>
            </div>
          </div>

          {/* Scopes */}
          <div className="space-y-1">
            <Label className={labelCls}>Scopes</Label>
            <Input
              className={inputCls}
              value={form.scopes}
              onChange={(e) => setForm((f) => ({ ...f, scopes: e.target.value }))}
              placeholder="e.g. nl, nl-nh, nl-nh-dhr"
            />
            <p className="text-[0.625rem] text-muted-foreground">
              Comma-separated —{' '}
              <a
                href="https://meshwiki.nl/wiki/Lijst_van_regio%27s"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                MeshWiki region guide
              </a>
            </p>
            {/* Scope pills preview */}
            {parseCSV(form.scopes).length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {parseCSV(form.scopes).map((s) => (
                  <span
                    key={s}
                    className={cn(
                      'inline-flex items-center rounded px-1.5 py-0.5 text-[0.625rem] font-medium',
                      isVeiligheidsregio(s)
                        ? 'bg-orange-500/15 text-orange-700 dark:text-orange-400 ring-1 ring-orange-500/30'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="space-y-1">
            <Label className={labelCls}>Tags</Label>
            <Input
              className={inputCls}
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              placeholder="e.g. Emergency, Repeater"
            />
            <p className="text-[0.625rem] text-muted-foreground">Comma-separated</p>
          </div>

          {/* Alias of */}
          <div className="space-y-1">
            <Label className={labelCls}>Alias of</Label>
            <Input
              className={inputCls}
              value={form.alias_of}
              onChange={(e) => setForm((f) => ({ ...f, alias_of: e.target.value }))}
              placeholder="e.g. #main-channel"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label className={labelCls}>Notes</Label>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm min-h-[60px] resize-y"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Any additional notes…"
            />
          </div>

          {/* Last Heard + Added */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className={labelCls}>Last Heard</Label>
              <Input
                type="date"
                className={inputCls}
                value={form.lastHeard}
                onChange={(e) => setForm((f) => ({ ...f, lastHeard: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label className={labelCls}>Added</Label>
              <Input
                type="date"
                className={inputCls}
                value={form.added}
                onChange={(e) => setForm((f) => ({ ...f, added: e.target.value }))}
              />
            </div>
          </div>

          {/* Verified + Recommended + Private */}
          <div className="flex gap-6 pt-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.verified}
                onChange={(e) => setForm((f) => ({ ...f, verified: e.target.checked }))}
                className="rounded"
              />
              Verified
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.recommended}
                onChange={(e) => setForm((f) => ({ ...f, recommended: e.target.checked }))}
                className="rounded"
              />
              Recommended
            </label>
            <label
              className="flex items-center gap-2 text-sm cursor-pointer"
              title="Private channels are never included in any export"
            >
              <input
                type="checkbox"
                checked={form.private}
                onChange={(e) => setForm((f) => ({ ...f, private: e.target.checked }))}
                className="rounded accent-destructive"
              />
              <span className={form.private ? 'text-destructive font-medium' : ''}>
                Private (exclude from export)
              </span>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add channel form state ─────────────────────────────────────────────────────

interface AddFormState {
  channel: string;
  category: string;
  subcategory: string;
  region: string;
  language: string;
  country: string;
  notes: string;
  status: RegistryChannel['status'];
}

const EMPTY_ADD_FORM: AddFormState = {
  channel: '',
  category: '',
  subcategory: '',
  region: '',
  language: '',
  country: '',
  notes: '',
  status: 'active',
};

// ── Grid columns (shared between header and rows) ─────────────────────────────

const COL_TEMPLATE = '28px 1fr 130px 90px 80px 90px 80px 80px 60px 44px 52px';

// ── Main component ────────────────────────────────────────────────────────────

export default function ChannelRegistryView({
  channels,
  channelStats,
}: {
  channels?: Channel[];
  channelStats?: Record<string, ChannelBulkStats>;
}) {
  const [registry, setRegistry] = useState<RegistryChannel[]>(() => {
    const stored = loadRegistry();
    if (!channels?.length) return stored;
    const { result, added } = seedFromRadioChannels(channels, stored);
    if (added > 0) saveRegistry(result);
    return added > 0 ? result : stored;
  });
  const [query, setQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | RegistryChannel['status']>('');
  const [filterSource, setFilterSource] = useState<'' | RegistryChannel['source']>('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSubcategory, setFilterSubcategory] = useState('');
  const [filterRegion, setFilterRegion] = useState('');
  const [filterScope, setFilterScope] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('lastHeard');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [editingChannel, setEditingChannel] = useState<RegistryChannel | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddFormState>(EMPTY_ADD_FORM);
  const [addError, setAddError] = useState('');
  const [toast, setToast] = useState<{ msg: string; variant: 'ok' | 'err' | 'info' } | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function showToast(msg: string, variant: 'ok' | 'err' | 'info' = 'info') {
    setToast({ msg, variant });
    setTimeout(() => setToast(null), 5000);
  }

  // Map: uppercase hex key → registry channel name (used to resolve DB stats).
  // Hashtag channels get a # prefix if missing; non-hashtag channels (e.g. "Public")
  // keep their original name so applyChannelStats can match the registry entry.
  const channelNameByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const ch of channels ?? []) {
      const name = ch.is_hashtag ? (ch.name.startsWith('#') ? ch.name : `#${ch.name}`) : ch.name;
      m.set(ch.key.toUpperCase(), name);
    }
    return m;
  }, [channels]);

  // ── Seed from radio channels ────────────────────────────────────────────────
  useEffect(() => {
    if (!channels?.length) return;
    setRegistry((current) => {
      const { result, added } = seedFromRadioChannels(channels, current);
      if (added > 0) saveRegistry(result);
      return added > 0 ? result : current;
    });
  }, [channels]);

  // ── Apply DB stats (count, first_at, last_at) to registry ───────────────────
  // Updates firstSeen, added (if unset), lastHeard, and packets from authoritative DB data.
  useEffect(() => {
    if (!channelStats || !Object.keys(channelStats).length) return;
    setRegistry((current) => {
      const { result, changed } = applyChannelStats(channelStats, channelNameByKey, current);
      if (changed > 0) saveRegistry(result);
      return changed > 0 ? result : current;
    });
  }, [channelStats, channelNameByKey]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const categoryOptions = useMemo(
    () => [...new Set(registry.map((e) => e.category).filter(Boolean))].sort(),
    [registry]
  );

  const regionOptions = useMemo(
    () => [...new Set(registry.map((e) => e.region).filter(Boolean))].sort(),
    [registry]
  );
  const countryOptions = useMemo(
    () => [...new Set(registry.map((e) => e.country).filter(Boolean))].sort(),
    [registry]
  );
  const scopeOptions = useMemo(
    () => [...new Set(registry.flatMap((e) => e.scopes))].sort(),
    [registry]
  );
  const subcategoryOptions = useMemo(() => {
    const base = filterCategory ? registry.filter((e) => e.category === filterCategory) : registry;
    return [...new Set(base.map((e) => e.subcategory).filter(Boolean))].sort();
  }, [registry, filterCategory]);

  // categoryMap: lowercase-category → Set<subcategory> — for datalist autocomplete
  const categoryMap = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of registry) {
      const key = e.category.toLowerCase();
      if (!key) continue;
      if (!m.has(key)) m.set(key, new Set());
      if (e.subcategory) m.get(key)!.add(e.subcategory);
    }
    return m;
  }, [registry]);

  // Live count: use packets field (kept in sync by applyChannelStats + handleChannelMessage)
  const getLiveCount = useCallback((entry: RegistryChannel): number => entry.packets, []);

  const sorted = useMemo(() => {
    let list = registry;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(
        (e) =>
          e.channel.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          e.subcategory.toLowerCase().includes(q) ||
          e.notes.toLowerCase().includes(q) ||
          e.country.toLowerCase().includes(q) ||
          e.region.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q)) ||
          e.scopes.some((s) => s.toLowerCase().includes(q))
      );
    }
    if (filterStatus) list = list.filter((e) => e.status === filterStatus);
    if (filterSource) list = list.filter((e) => e.source === filterSource);
    if (filterCategory) list = list.filter((e) => e.category === filterCategory);
    if (filterSubcategory) list = list.filter((e) => e.subcategory === filterSubcategory);
    if (filterRegion) list = list.filter((e) => e.region === filterRegion);
    if (filterScope) list = list.filter((e) => e.scopes.includes(filterScope));
    if (filterCountry) list = list.filter((e) => e.country === filterCountry);
    return sortRegistry(list, sortField, sortDir);
  }, [
    registry,
    query,
    filterStatus,
    filterSource,
    filterCategory,
    filterSubcategory,
    filterRegion,
    filterScope,
    filterCountry,
    sortField,
    sortDir,
  ]);

  const activeFilters =
    [
      filterStatus,
      filterSource,
      filterCategory,
      filterSubcategory,
      filterRegion,
      filterScope,
      filterCountry,
    ].filter(Boolean).length + (query ? 1 : 0);

  // ── Sort handler ─────────────────────────────────────────────────────────────
  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  // ── Selection ────────────────────────────────────────────────────────────────
  function toggleSelect(name: string) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const allSortedSelected = sorted.length > 0 && sorted.every((e) => selection.has(e.channel));
  const someSortedSelected = sorted.some((e) => selection.has(e.channel));

  function toggleSelectAll() {
    if (allSortedSelected) {
      setSelection((prev) => {
        const next = new Set(prev);
        sorted.forEach((e) => next.delete(e.channel));
        return next;
      });
    } else {
      setSelection((prev) => {
        const next = new Set(prev);
        sorted.forEach((e) => next.add(e.channel));
        return next;
      });
    }
  }

  function buildKeyByName() {
    const m = new Map<string, string>();
    for (const [hexKey, name] of channelNameByKey) {
      m.set(name.toLowerCase(), hexKey);
    }
    return m;
  }

  // ── Mutations ───────────────────────────────────────────────────────────────
  const persist = useCallback((next: RegistryChannel[]) => {
    setRegistry(next);
    saveRegistry(next);
  }, []);

  function handleEditSave(channelName: string, patch: Partial<RegistryChannel>) {
    persist(updateChannel(channelName, patch, registry));
  }

  function handleDelete(channelName: string) {
    if (!confirm(`Remove ${channelName} from the registry?`)) return;
    persist(registry.filter((e) => e.channel !== channelName));
  }

  function handleAdd() {
    const name = addForm.channel.trim();
    if (!name) {
      setAddError('Channel name is required.');
      return;
    }
    const next = addManualChannel(
      name,
      {
        category: addForm.category,
        subcategory: addForm.subcategory,
        region: addForm.region,
        language: parseCSV(addForm.language.toUpperCase()),
        country: addForm.country,
        notes: addForm.notes,
        status: addForm.status,
      },
      registry
    );
    persist(next);
    setAddForm(EMPTY_ADD_FORM);
    setAddError('');
    setShowAddForm(false);
  }

  function handleExport() {
    const base = selection.size > 0 ? registry.filter((e) => selection.has(e.channel)) : sorted;
    // Never export private-flagged channels
    const rows = base.filter((e) => !e.private);
    const date = new Date().toISOString().slice(0, 10);
    triggerDownload(JSON.stringify(rows, null, 2), `meshcore_registry_${date}.json`);
  }

  function handleExportProjectA() {
    const base = selection.size > 0 ? registry.filter((e) => selection.has(e.channel)) : sorted;
    const rows = base.filter((e) => !e.private);
    const date = new Date().toISOString().slice(0, 10);
    triggerDownload(
      JSON.stringify(toProjectAFormat(rows, buildKeyByName()), null, 2),
      `channels_${date}.json`
    );
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        const incoming = Array.isArray(parsed) ? parsed : [parsed];
        const { result, added, updated } = mergeImport(incoming, registry);
        persist(result);
        showToast(`Imported: ${added} new, ${updated} updated.`, 'ok');
      } catch {
        showToast('Import failed: invalid JSON.', 'err');
      }
    };
    reader.readAsText(file);
  }

  async function handleSync() {
    setSyncLoading(true);
    try {
      const data = await api.syncRegistry();
      if (!Array.isArray(data?.channels)) throw new Error('Unexpected response from server.');
      const { result, added } = addMissingFromSync(data.channels, registry);
      if (added > 0) {
        persist(result);
      }
      showToast(
        added > 0 ? `Synced: ${added} new channel${added === 1 ? '' : 's'} added.` : 'Already up to date.',
        added > 0 ? 'ok' : 'info'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sync failed.', 'err');
    } finally {
      setSyncLoading(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full channel-registry">
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <h2 className="flex justify-between items-center px-4 py-2.5 border-b border-border font-semibold text-base shrink-0">
        <span className="flex items-center gap-2">
          <Hash className="h-4 w-4" />
          Channel Registry
          <span className="text-xs font-normal text-muted-foreground">
            {registry.length} {registry.length === 1 ? 'channel' : 'channels'}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => fileInputRef.current?.click()}
            title="Import JSON (Project A or Project B format)"
          >
            <Upload className="h-3.5 w-3.5 mr-1" />
            Import
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => void handleSync()}
            disabled={syncLoading}
            title="Sync missing channels from the configured remote list"
          >
            {syncLoading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            Sync
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={handleExport}
            disabled={registry.length === 0}
            title={
              selection.size > 0
                ? `Export ${selection.size} selected channels (Project B format)`
                : sorted.length < registry.length
                  ? `Export ${sorted.length} filtered channels (Project B format)`
                  : 'Export all channels (Project B format)'
            }
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            {selection.size > 0 ? `Export (${selection.size})` : 'Export'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={handleExportProjectA}
            disabled={registry.length === 0}
            title={
              selection.size > 0
                ? `Export ${selection.size} selected channels (Project A format)`
                : sorted.length < registry.length
                  ? `Export ${sorted.length} filtered channels (Project A format)`
                  : 'Export all channels (Project A format)'
            }
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            {selection.size > 0 ? `Export (${selection.size}) (A)` : 'Export (A)'}
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => {
              setShowAddForm(true);
              setAddError('');
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </span>
      </h2>

      {/* ── Hidden file input ─────────────────────────────────────────────────── */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* ── Toast ────────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          className={cn(
            'mx-4 mt-3 rounded-md border px-3 py-2 text-sm shrink-0 registry-toast',
            toast.variant === 'ok'
              ? 'border-green-500/30 bg-green-500/10 text-green-600 registry-toast-ok'
              : toast.variant === 'err'
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-border/70 bg-muted/30 text-muted-foreground'
          )}
        >
          {toast.msg}
        </div>
      )}

      {/* ── Filter bar ───────────────────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2 shrink-0 flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-sm"
            placeholder="Search channels, tags, notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setQuery('')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as '' | RegistryChannel['status'])}
        >
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="dormant">Dormant</option>
          <option value="experimental">Experimental</option>
        </select>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground"
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value as '' | RegistryChannel['source'])}
        >
          <option value="">All sources</option>
          <option value="finder">Finder</option>
          <option value="radio">Radio</option>
          <option value="manual">Manual</option>
          <option value="imported">Imported</option>
        </select>
        {categoryOptions.length > 0 && (
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground"
            value={filterCategory}
            onChange={(e) => {
              setFilterCategory(e.target.value);
              setFilterSubcategory('');
            }}
          >
            <option value="">All categories</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        {subcategoryOptions.length > 0 && (
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground"
            value={filterSubcategory}
            onChange={(e) => setFilterSubcategory(e.target.value)}
          >
            <option value="">All subcategories</option>
            {subcategoryOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        {regionOptions.length > 0 && (
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground"
            value={filterRegion}
            onChange={(e) => setFilterRegion(e.target.value)}
          >
            <option value="">All regions</option>
            {regionOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
        {scopeOptions.length > 0 && (
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground"
            value={filterScope}
            onChange={(e) => setFilterScope(e.target.value)}
          >
            <option value="">All scopes</option>
            {scopeOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        {countryOptions.length > 0 && (
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground"
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
          >
            <option value="">All countries</option>
            {countryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        {activeFilters > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs px-2"
            onClick={() => {
              setQuery('');
              setFilterStatus('');
              setFilterSource('');
              setFilterCategory('');
              setFilterSubcategory('');
              setFilterRegion('');
              setFilterScope('');
              setFilterCountry('');
            }}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Clear ({activeFilters})
          </Button>
        )}
      </div>

      {/* ── Selection bar ────────────────────────────────────────────────────── */}
      {selection.size > 0 && (
        <div className="mx-4 mb-2 shrink-0 flex items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-3 py-1.5 text-xs registry-sel-bar">
          <span className="text-muted-foreground flex-1 text-xs">
            {selection.size} {selection.size === 1 ? 'channel' : 'channels'} selected — use Export
            buttons above
          </span>
          <button
            className="text-muted-foreground hover:text-foreground ml-1"
            onClick={() => setSelection(new Set())}
            title="Clear selection"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────────────────── */}
      {registry.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground text-sm px-8 text-center">
          <Hash className="h-8 w-8 opacity-40" />
          <p>No channels in the registry yet.</p>
          <p className="text-xs">
            Add channels manually, import a JSON file, or they'll appear automatically as the
            Channel Finder discovers them.
          </p>
        </div>
      )}

      {/* ── No results ───────────────────────────────────────────────────────── */}
      {registry.length > 0 && sorted.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          No channels match the current filters.
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      {sorted.length > 0 && (
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {/* Sticky column header */}
          <div
            className="sticky top-0 bg-background z-10 grid gap-x-2 items-center px-3 py-1.5 border-b border-border/50"
            style={{ gridTemplateColumns: COL_TEMPLATE }}
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-border cursor-pointer"
              checked={allSortedSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSortedSelected && !allSortedSelected;
              }}
              onChange={toggleSelectAll}
              title={allSortedSelected ? 'Deselect all' : 'Select all visible'}
            />
            <SortHeader
              label="Channel"
              field="channel"
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
            />
            <SortHeader
              label="Category"
              field="category"
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
            />
            <SortHeader
              label="Country"
              field="country"
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
            />
            <SortHeader
              label="Region"
              field="region"
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
            />
            <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
              Lang
            </span>
            <SortHeader
              label="Status"
              field="status"
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
            />
            <SortHeader
              label="Source"
              field="source"
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
            />
            <SortHeader
              label="Last heard"
              field="lastHeard"
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
            />
            <SortHeader
              label="Pkts"
              field="packets"
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
            />
            <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium text-right">
              Actions
            </span>
          </div>

          {/* Rows */}
          <div className="divide-y divide-border/30">
            {sorted.map((entry) => (
              <ChannelRow
                key={entry.channel}
                entry={entry}
                liveCount={getLiveCount(entry)}
                selected={selection.has(entry.channel)}
                onToggleSelect={toggleSelect}
                onEdit={setEditingChannel}
                onDelete={handleDelete}
              />
            ))}
          </div>

          <div className="pt-3 text-xs text-center text-muted-foreground">
            {sorted.length === registry.length
              ? `${registry.length} channels`
              : `${sorted.length} of ${registry.length} channels`}
          </div>
        </div>
      )}

      {/* ── Add channel dialog ────────────────────────────────────────────────── */}
      {showAddForm && (
        <Dialog open onOpenChange={(open) => !open && setShowAddForm(false)}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Add Channel</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="space-y-1">
                <Label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
                  Channel name *
                </Label>
                <Input
                  className="h-7 text-sm"
                  placeholder="#example"
                  value={addForm.channel}
                  onChange={(e) => setAddForm((f) => ({ ...f, channel: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  autoFocus
                />
                {addError && <p className="text-xs text-destructive">{addError}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
                    Category
                  </Label>
                  <Input
                    className="h-7 text-sm"
                    placeholder="e.g. Regional"
                    value={addForm.category}
                    onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
                    Subcategory
                  </Label>
                  <Input
                    className="h-7 text-sm"
                    placeholder="e.g. City"
                    value={addForm.subcategory}
                    onChange={(e) => setAddForm((f) => ({ ...f, subcategory: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
                    Country
                  </Label>
                  <Input
                    className="h-7 text-sm"
                    placeholder="e.g. Netherlands"
                    value={addForm.country}
                    onChange={(e) => setAddForm((f) => ({ ...f, country: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
                    Language
                  </Label>
                  <Input
                    className="h-7 text-sm"
                    placeholder="NL, EN"
                    value={addForm.language}
                    onChange={(e) => setAddForm((f) => ({ ...f, language: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
                    Region
                  </Label>
                  <Input
                    className="h-7 text-sm"
                    placeholder="e.g. Amsterdam"
                    value={addForm.region}
                    onChange={(e) => setAddForm((f) => ({ ...f, region: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
                    Status
                  </Label>
                  <select
                    className="h-7 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={addForm.status}
                    onChange={(e) =>
                      setAddForm((f) => ({
                        ...f,
                        status: e.target.value as RegistryChannel['status'],
                      }))
                    }
                  >
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                    <option value="dormant">dormant</option>
                    <option value="experimental">experimental</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
                  Notes
                </Label>
                <Input
                  className="h-7 text-sm"
                  placeholder="Optional description"
                  value={addForm.notes}
                  onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowAddForm(false);
                  setAddForm(EMPTY_ADD_FORM);
                  setAddError('');
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleAdd}>
                Add Channel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Edit modal ───────────────────────────────────────────────────────── */}
      {editingChannel && (
        <EditChannelModal
          channel={editingChannel}
          categoryMap={categoryMap}
          onSave={(patch) => handleEditSave(editingChannel.channel, patch)}
          onClose={() => setEditingChannel(null)}
        />
      )}
    </div>
  );
}

// ── Row component ─────────────────────────────────────────────────────────────

function ChannelRow({
  entry,
  liveCount,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
}: {
  entry: RegistryChannel;
  liveCount: number;
  selected: boolean;
  onToggleSelect: (name: string) => void;
  onEdit: (e: RegistryChannel) => void;
  onDelete: (name: string) => void;
}) {
  return (
    <div
      className={cn(
        'grid gap-x-2 items-center px-3 py-2 hover:bg-accent/30 transition-colors group',
        selected && 'bg-accent/20'
      )}
      style={{ gridTemplateColumns: COL_TEMPLATE }}
    >
      <input
        type="checkbox"
        className="h-3.5 w-3.5 rounded border-border cursor-pointer"
        checked={selected}
        onChange={() => onToggleSelect(entry.channel)}
        onClick={(e) => e.stopPropagation()}
      />
      <span className="font-medium text-sm truncate flex items-center gap-1" title={entry.channel}>
        {entry.private && (
          <Lock
            className="h-3 w-3 text-destructive flex-shrink-0"
            aria-label="Private — excluded from export"
          />
        )}
        {entry.channel}
      </span>
      <span
        className="text-xs text-muted-foreground truncate"
        title={entry.subcategory ? `${entry.category} / ${entry.subcategory}` : entry.category}
      >
        {entry.category || '—'}
        {entry.subcategory && (
          <span className="text-muted-foreground/60"> / {entry.subcategory}</span>
        )}
      </span>
      <span className="text-xs text-muted-foreground truncate">{entry.country || '—'}</span>
      <span className="text-xs text-muted-foreground truncate">{entry.region || '—'}</span>
      <span className="text-xs text-muted-foreground truncate">
        {entry.language.length > 0 ? entry.language.join(', ') : '—'}
      </span>
      <span>{statusBadge(entry.status)}</span>
      <span>{sourceBadge(entry.source)}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {fmtDatetime(entry.lastHeard)}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums text-right">
        {liveCount > 0 ? liveCount : '—'}
      </span>
      <span className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent"
          onClick={() => onEdit(entry)}
          title="Edit"
        >
          <Edit2 className="h-3 w-3" />
        </button>
        <button
          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={() => onDelete(entry.channel)}
          title="Remove"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </span>
    </div>
  );
}

// ── Integration helper (exported for channel finder use) ──────────────────────

/**
 * Call this from the Channel Finder (CrackerPanel) when a channel is discovered.
 * Automatically updates the registry in localStorage.
 */
export function notifyChannelFound(channelName: string): RegistryChannel[] {
  const existing = loadRegistry();
  const updated = recordFinderDiscovery(channelName, existing);
  saveRegistry(updated);
  return updated;
}
