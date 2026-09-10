import { useState, useEffect, useRef } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { toast } from '../ui/sonner';
import { api } from '../../api';
import { formatTime } from '../../utils/messageParser';
import type { AnalyzerSite, AppSettings, AppSettingsUpdate, HealthStatus } from '../../types';

function isValidNodeTemplate(template: string): boolean {
  const t = template.trim();
  return /^https?:\/\//i.test(t) && t.includes('{pubkey}');
}

function isValidPacketTemplate(template: string): boolean {
  const t = template.trim();
  return /^https?:\/\//i.test(t) && t.includes('{hash}');
}

export function SettingsDatabaseSection({
  appSettings,
  health,
  onSaveAppSettings,
  onHealthRefresh,
  className,
}: {
  appSettings: AppSettings;
  health: HealthStatus | null;
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
  onHealthRefresh: () => Promise<void>;
  className?: string;
}) {
  const [retentionDays, setRetentionDays] = useState('14');
  const [cleaning, setCleaning] = useState(false);
  const [purgingDecryptedRaw, setPurgingDecryptedRaw] = useState(false);
  const [autoDecryptOnAdvert, setAutoDecryptOnAdvert] = useState(false);
  const [syncUrl, setSyncUrl] = useState('');
  const [analyzerSites, setAnalyzerSites] = useState<AnalyzerSite[]>([]);
  const [draftName, setDraftName] = useState('');
  const [draftNodeUrl, setDraftNodeUrl] = useState('');
  const [draftPacketUrl, setDraftPacketUrl] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editNodeUrl, setEditNodeUrl] = useState('');
  const [editPacketUrl, setEditPacketUrl] = useState('');

  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    setAutoDecryptOnAdvert(appSettings.auto_decrypt_dm_on_advert);
    setSyncUrl(appSettings.registry_sync_url ?? '');
    setAnalyzerSites(appSettings.analyzer_sites ?? []);
    setEditingIndex(null);
  }, [appSettings]);

  const handleCleanup = async () => {
    const days = parseInt(retentionDays, 10);
    if (isNaN(days) || days < 1) {
      toast.error('Invalid retention days', {
        description: 'Retention days must be at least 1',
      });
      return;
    }

    setCleaning(true);

    try {
      const result = await api.runMaintenance({ pruneUndecryptedDays: days });
      toast.success('Database cleanup complete', {
        description: `Deleted ${result.packets_deleted} old packet${result.packets_deleted === 1 ? '' : 's'}`,
      });
      await onHealthRefresh();
    } catch (err) {
      console.error('Failed to run maintenance:', err);
      toast.error('Database cleanup failed', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setCleaning(false);
    }
  };

  const handlePurgeDecryptedRawPackets = async () => {
    setPurgingDecryptedRaw(true);

    try {
      const result = await api.runMaintenance({ purgeLinkedRawPackets: true });
      toast.success('Decrypted raw packets purged', {
        description: `Deleted ${result.packets_deleted} raw packet${result.packets_deleted === 1 ? '' : 's'}`,
      });
      await onHealthRefresh();
    } catch (err) {
      console.error('Failed to purge decrypted raw packets:', err);
      toast.error('Failed to purge decrypted raw packets', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setPurgingDecryptedRaw(false);
    }
  };

  const persistAppSettings = (update: AppSettingsUpdate, revert: () => void): Promise<void> => {
    const chained = saveChainRef.current.then(async () => {
      try {
        await onSaveAppSettings(update);
      } catch (err) {
        console.error('Failed to save database settings:', err);
        revert();
        toast.error('Failed to save setting', {
          description: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    });
    saveChainRef.current = chained;
    return chained;
  };

  const persistAnalyzerSites = (next: AnalyzerSite[]) => {
    const prev = analyzerSites;
    setAnalyzerSites(next);
    void persistAppSettings({ analyzer_sites: next }, () => setAnalyzerSites(prev));
  };

  const buildValidatedSite = (
    rawName: string,
    rawNodeUrl: string,
    rawPacketUrl: string
  ): AnalyzerSite | null => {
    const name = rawName.trim();
    const nodeUrl = rawNodeUrl.trim();
    const packetUrl = rawPacketUrl.trim();
    if (!name) {
      toast.error('Analyzer site needs a name');
      return null;
    }
    if (!isValidNodeTemplate(nodeUrl)) {
      toast.error('Node URL must be an http(s) URL containing {pubkey}');
      return null;
    }
    if (packetUrl && !isValidPacketTemplate(packetUrl)) {
      toast.error('Packet URL must be an http(s) URL containing {hash}');
      return null;
    }
    return { name, node_url_template: nodeUrl, packet_url_template: packetUrl || null };
  };

  const handleAddAnalyzerSite = () => {
    const site = buildValidatedSite(draftName, draftNodeUrl, draftPacketUrl);
    if (!site) return;
    persistAnalyzerSites([...analyzerSites, site]);
    setDraftName('');
    setDraftNodeUrl('');
    setDraftPacketUrl('');
  };

  const handleRemoveAnalyzerSite = (index: number) => {
    if (editingIndex === index) setEditingIndex(null);
    persistAnalyzerSites(analyzerSites.filter((_, i) => i !== index));
  };

  const handleStartEditAnalyzerSite = (index: number) => {
    const site = analyzerSites[index];
    if (!site) return;
    setEditingIndex(index);
    setEditName(site.name);
    setEditNodeUrl(site.node_url_template);
    setEditPacketUrl(site.packet_url_template ?? '');
  };

  const handleSaveEditAnalyzerSite = (index: number) => {
    const site = buildValidatedSite(editName, editNodeUrl, editPacketUrl);
    if (!site) return;
    persistAnalyzerSites(analyzerSites.map((existing, i) => (i === index ? site : existing)));
    setEditingIndex(null);
  };

  return (
    <div className={className}>
      {/* ── Database Overview ── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">Database Overview</h3>
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm">Database size</span>
            <span className="text-sm font-semibold">{health?.database_size_mb ?? '?'} MB</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm">Oldest undecrypted packet</span>
            {health?.oldest_undecrypted_timestamp ? (
              <span className="text-sm font-semibold">
                {formatTime(health.oldest_undecrypted_timestamp)}
                <span className="font-normal text-muted-foreground ml-1">
                  ({Math.floor((Date.now() / 1000 - health.oldest_undecrypted_timestamp) / 86400)}{' '}
                  days)
                </span>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">None</span>
            )}
          </div>
        </div>
      </div>

      <Separator />

      {/* ── Storage Cleanup ── */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold tracking-tight">Storage Cleanup</h3>

        <div className="rounded-md border border-border p-3 space-y-2">
          <h3 className="text-sm font-semibold">Delete Undecrypted Packets</h3>
          <p className="text-[0.8125rem] text-muted-foreground">
            Permanently deletes stored raw packets that have not yet been decrypted. These are
            retained in case you later obtain the correct key — once deleted, these messages can
            never be recovered.
          </p>
          <div className="flex gap-2 items-end">
            <div className="space-y-1">
              <Label htmlFor="retention-days" className="text-xs text-muted-foreground">
                Older than (days)
              </Label>
              <Input
                id="retention-days"
                type="number"
                min="1"
                max="365"
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                className="w-24"
              />
            </div>
            <Button
              variant="outline"
              onClick={handleCleanup}
              disabled={cleaning}
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
            >
              {cleaning ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border p-3 space-y-2">
          <h3 className="text-sm font-semibold">Purge Archival Raw Packets</h3>
          <p className="text-[0.8125rem] text-muted-foreground">
            Deletes the raw packet bytes behind messages that are already decrypted and visible in
            chat. This frees space but removes packet-analysis availability for those messages. It
            does not affect displayed messages or future decryption.
          </p>
          <Button
            variant="outline"
            onClick={handlePurgeDecryptedRawPackets}
            disabled={purgingDecryptedRaw}
            className="w-full border-warning/50 text-warning hover:bg-warning/10"
          >
            {purgingDecryptedRaw ? 'Purging...' : 'Purge Archival Packets'}
          </Button>
        </div>
      </div>

      <Separator />

      {/* ── DM Decryption ── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">DM Decryption</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoDecryptOnAdvert}
            onChange={(e) => {
              const next = e.target.checked;
              const prev = autoDecryptOnAdvert;
              setAutoDecryptOnAdvert(next);
              void persistAppSettings({ auto_decrypt_dm_on_advert: next }, () =>
                setAutoDecryptOnAdvert(prev)
              );
            }}
            className="w-4 h-4 rounded border-input accent-primary"
          />
          <span className="text-sm">Auto-decrypt historical DMs when new contact advertises</span>
        </label>
        <p className="text-[0.8125rem] text-muted-foreground">
          When enabled, the server will automatically try to decrypt stored DM packets when a new
          contact sends an advertisement. This may cause brief delays on large packet backlogs.
        </p>
      </div>

      <Separator />

      {/* Channel Registry */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">Channel Registry</h3>
        <div className="space-y-1.5">
          <Label htmlFor="registry-sync-url" className="text-sm font-medium">
            Channel list sync URL
          </Label>
          <Input
            id="registry-sync-url"
            type="url"
            value={syncUrl}
            placeholder="https://example.com/channels.json"
            onChange={(e) => setSyncUrl(e.target.value)}
            onBlur={() => {
              const trimmed = syncUrl.trim();
              setSyncUrl(trimmed);
              void persistAppSettings({ registry_sync_url: trimmed }, () =>
                setSyncUrl(appSettings.registry_sync_url ?? '')
              );
            }}
            className="font-mono text-xs"
          />
          <p className="text-[0.8125rem] text-muted-foreground">
            URL of a remote JSON channel list (<code className="text-xs">{`{"#name": "key"}`}</code>{' '}
            format). The server fetches this when you click Sync in the Channel Registry.
          </p>
        </div>
      </div>

      <Separator />

      {/* External Analyzers */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">External Analyzers</h3>
        <p className="text-[0.8125rem] text-muted-foreground">
          Sites you can open from a contact&apos;s info pane to look up a node. Use{' '}
          <code className="text-xs">{'{pubkey}'}</code> in the node URL (and{' '}
          <code className="text-xs">{'{hash}'}</code> in an optional packet URL) as the placeholder.
        </p>
        <p className="text-[0.8125rem] text-warning">
          Privacy: opening a lookup sends the node&apos;s public key to that third-party site in the
          URL, which it can log. Nothing is sent until you click a lookup.
        </p>

        {analyzerSites.length > 0 ? (
          <ul className="space-y-2">
            {analyzerSites.map((site, index) =>
              editingIndex === index ? (
                <li
                  key={`${site.name}-${index}`}
                  className="rounded-md border border-border p-2.5 space-y-2"
                >
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Name</Label>
                    <Input
                      aria-label={`Edit name for ${site.name}`}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Node URL template</Label>
                    <Input
                      aria-label={`Edit node URL for ${site.name}`}
                      value={editNodeUrl}
                      onChange={(e) => setEditNodeUrl(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Packet URL template (optional)
                    </Label>
                    <Input
                      aria-label={`Edit packet URL for ${site.name}`}
                      value={editPacketUrl}
                      onChange={(e) => setEditPacketUrl(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSaveEditAnalyzerSite(index)}
                      aria-label={`Save analyzer site ${site.name}`}
                    >
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingIndex(null)}
                      aria-label={`Cancel editing analyzer site ${site.name}`}
                    >
                      Cancel
                    </Button>
                  </div>
                </li>
              ) : (
                <li
                  key={`${site.name}-${index}`}
                  className="rounded-md border border-border p-2.5 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="text-sm font-medium">{site.name}</div>
                    <div className="text-xs font-mono text-muted-foreground break-all">
                      {site.node_url_template}
                    </div>
                    {site.packet_url_template && (
                      <div className="text-xs font-mono text-muted-foreground break-all">
                        {site.packet_url_template}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStartEditAnalyzerSite(index)}
                      aria-label={`Edit analyzer site ${site.name}`}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-destructive/50 text-destructive hover:bg-destructive/10"
                      onClick={() => handleRemoveAnalyzerSite(index)}
                      aria-label={`Remove analyzer site ${site.name}`}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              )
            )}
          </ul>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground italic">
            No analyzer sites configured.
          </p>
        )}

        <div className="rounded-md border border-border p-3 space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor="analyzer-name" className="text-xs text-muted-foreground">
              Name
            </Label>
            <Input
              id="analyzer-name"
              value={draftName}
              placeholder="mc-radar"
              onChange={(e) => setDraftName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="analyzer-node-url" className="text-xs text-muted-foreground">
              Node URL template
            </Label>
            <Input
              id="analyzer-node-url"
              value={draftNodeUrl}
              placeholder="https://mc-radar.woodwar.com/node/{pubkey}"
              onChange={(e) => setDraftNodeUrl(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="analyzer-packet-url" className="text-xs text-muted-foreground">
              Packet URL template (optional)
            </Label>
            <Input
              id="analyzer-packet-url"
              value={draftPacketUrl}
              placeholder="https://example.com/#packets?hash={hash}"
              onChange={(e) => setDraftPacketUrl(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <Button variant="outline" onClick={handleAddAnalyzerSite} className="w-full">
            Add analyzer site
          </Button>
        </div>
      </div>
    </div>
  );
}
