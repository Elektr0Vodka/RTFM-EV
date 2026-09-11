import { useState, useEffect, useRef } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { toast } from '../ui/sonner';
import { api } from '../../api';
import { formatTime } from '../../utils/messageParser';
import { loadSyncedWordlist, saveSyncedWordlist } from '../../lib/wordlistSync';
import { useT } from '../../i18n';
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
  const t = useT();
  const [retentionDays, setRetentionDays] = useState('14');
  const [cleaning, setCleaning] = useState(false);
  const [purgingDecryptedRaw, setPurgingDecryptedRaw] = useState(false);
  const [autoDecryptOnAdvert, setAutoDecryptOnAdvert] = useState(false);
  const [syncUrl, setSyncUrl] = useState('');
  const [wordlistSyncUrl, setWordlistSyncUrl] = useState('');
  const [wordlistSyncing, setWordlistSyncing] = useState(false);
  const [syncedWordCount, setSyncedWordCount] = useState(0);
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
    setWordlistSyncUrl(appSettings.wordlist_sync_url ?? '');
    setSyncedWordCount(loadSyncedWordlist().length);
    setAnalyzerSites(appSettings.analyzer_sites ?? []);
    setEditingIndex(null);
  }, [appSettings]);

  const handleCleanup = async () => {
    const days = parseInt(retentionDays, 10);
    if (isNaN(days) || days < 1) {
      toast.error(t('settings_db_toast_invalid_retention_title'), {
        description: t('settings_db_toast_invalid_retention_desc'),
      });
      return;
    }

    setCleaning(true);

    try {
      const result = await api.runMaintenance({ pruneUndecryptedDays: days });
      toast.success(t('settings_db_toast_cleanup_complete_title'), {
        description: t('settings_db_toast_cleanup_complete_desc', {
          count: result.packets_deleted,
        }),
      });
      await onHealthRefresh();
    } catch (err) {
      console.error('Failed to run maintenance:', err);
      toast.error(t('settings_db_toast_cleanup_failed_title'), {
        description: err instanceof Error ? err.message : t('error_unknown'),
      });
    } finally {
      setCleaning(false);
    }
  };

  const handlePurgeDecryptedRawPackets = async () => {
    setPurgingDecryptedRaw(true);

    try {
      const result = await api.runMaintenance({ purgeLinkedRawPackets: true });
      toast.success(t('settings_db_toast_purge_complete_title'), {
        description: t('settings_db_toast_purge_complete_desc', { count: result.packets_deleted }),
      });
      await onHealthRefresh();
    } catch (err) {
      console.error('Failed to purge decrypted raw packets:', err);
      toast.error(t('settings_db_toast_purge_failed_title'), {
        description: err instanceof Error ? err.message : t('error_unknown'),
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
        toast.error(t('settings_db_toast_save_failed_title'), {
          description: err instanceof Error ? err.message : t('error_unknown'),
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
      toast.error(t('settings_db_analyzer_toast_no_name'));
      return null;
    }
    if (!isValidNodeTemplate(nodeUrl)) {
      toast.error(t('settings_db_analyzer_toast_bad_node_url'));
      return null;
    }
    if (packetUrl && !isValidPacketTemplate(packetUrl)) {
      toast.error(t('settings_db_analyzer_toast_bad_packet_url'));
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

  const handleSyncWordlist = async () => {
    if (!wordlistSyncUrl.trim()) {
      toast.error(t('settings_db_wordlist_toast_no_url'));
      return;
    }
    setWordlistSyncing(true);
    try {
      // Replace-not-append: store the exact synced set so a shrunk/renamed
      // upstream list does not leave stale candidates behind.
      const { words } = await api.syncWordlist();
      saveSyncedWordlist(words);
      setSyncedWordCount(words.length);
      toast.success(t('settings_db_wordlist_toast_synced', { count: words.length }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings_db_wordlist_toast_failed'));
    } finally {
      setWordlistSyncing(false);
    }
  };

  return (
    <div className={className}>
      {/* ── Database Overview ── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_db_overview_heading')}
        </h3>
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm">{t('settings_db_size_label')}</span>
            <span className="text-sm font-semibold">{health?.database_size_mb ?? '?'} MB</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm">{t('settings_db_oldest_undecrypted_label')}</span>
            {health?.oldest_undecrypted_timestamp ? (
              <span className="text-sm font-semibold">
                {formatTime(health.oldest_undecrypted_timestamp)}
                <span className="font-normal text-muted-foreground ml-1">
                  {t('settings_db_days_ago', {
                    count: Math.floor(
                      (Date.now() / 1000 - health.oldest_undecrypted_timestamp) / 86400
                    ),
                  })}
                </span>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">{t('settings_db_none')}</span>
            )}
          </div>
        </div>
      </div>

      <Separator />

      {/* ── Storage Cleanup ── */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_db_cleanup_heading')}
        </h3>

        <div className="rounded-md border border-border p-3 space-y-2">
          <h3 className="text-sm font-semibold">{t('settings_db_delete_undecrypted_heading')}</h3>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_db_delete_undecrypted_desc')}
          </p>
          <div className="flex gap-2 items-end">
            <div className="space-y-1">
              <Label htmlFor="retention-days" className="text-xs text-muted-foreground">
                {t('settings_db_older_than_days_label')}
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
              {cleaning ? t('settings_db_deleting') : t('common_delete')}
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border p-3 space-y-2">
          <h3 className="text-sm font-semibold">{t('settings_db_purge_archival_heading')}</h3>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_db_purge_archival_desc')}
          </p>
          <Button
            variant="outline"
            onClick={handlePurgeDecryptedRawPackets}
            disabled={purgingDecryptedRaw}
            className="w-full border-warning/50 text-warning hover:bg-warning/10"
          >
            {purgingDecryptedRaw
              ? t('settings_db_purging')
              : t('settings_db_purge_archival_button')}
          </Button>
        </div>
      </div>

      <Separator />

      {/* ── DM Decryption ── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_db_dm_decryption_heading')}
        </h3>
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
          <span className="text-sm">{t('settings_db_auto_decrypt_label')}</span>
        </label>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_db_auto_decrypt_desc')}
        </p>
      </div>

      <Separator />

      {/* Channel Registry */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_db_registry_heading')}
        </h3>
        <div className="space-y-1.5">
          <Label htmlFor="registry-sync-url" className="text-sm font-medium">
            {t('settings_db_registry_url_label')}
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
            {t('settings_db_registry_url_hint_prefix')}
            <code className="text-xs">{`{"#name": "key"}`}</code>{' '}
            {t('settings_db_registry_url_hint_suffix')}
          </p>
        </div>
      </div>

      <Separator />

      {/* Channel Finder Wordlist */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold tracking-tight">
            {t('settings_db_wordlist_heading')}
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncWordlist}
            disabled={wordlistSyncing || !wordlistSyncUrl.trim()}
          >
            {wordlistSyncing
              ? t('settings_db_wordlist_syncing')
              : t('settings_db_wordlist_sync_button')}
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wordlist-sync-url" className="text-sm font-medium">
            {t('settings_db_wordlist_url_label')}
          </Label>
          <Input
            id="wordlist-sync-url"
            type="url"
            value={wordlistSyncUrl}
            placeholder="https://example.com/wordlist.json"
            onChange={(e) => setWordlistSyncUrl(e.target.value)}
            onBlur={() => {
              const trimmed = wordlistSyncUrl.trim();
              setWordlistSyncUrl(trimmed);
              void persistAppSettings({ wordlist_sync_url: trimmed }, () =>
                setWordlistSyncUrl(appSettings.wordlist_sync_url ?? '')
              );
            }}
            className="font-mono text-xs"
          />
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_db_wordlist_url_hint')}
          </p>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_db_wordlist_cached_count', { count: syncedWordCount })}
          </p>
        </div>
      </div>

      <Separator />

      {/* External Analyzers */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_db_analyzer_heading')}
        </h3>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_db_analyzer_desc_prefix')} <code className="text-xs">{'{pubkey}'}</code>{' '}
          {t('settings_db_analyzer_desc_mid')} <code className="text-xs">{'{hash}'}</code>{' '}
          {t('settings_db_analyzer_desc_suffix')}
        </p>
        <p className="text-[0.8125rem] text-warning">{t('settings_db_analyzer_privacy')}</p>

        {analyzerSites.length > 0 ? (
          <ul className="space-y-2">
            {analyzerSites.map((site, index) =>
              editingIndex === index ? (
                <li
                  key={`${site.name}-${index}`}
                  className="rounded-md border border-border p-2.5 space-y-2"
                >
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">{t('common_name')}</Label>
                    <Input
                      aria-label={t('settings_db_analyzer_edit_name_aria', { name: site.name })}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {t('settings_db_analyzer_node_url_label')}
                    </Label>
                    <Input
                      aria-label={t('settings_db_analyzer_edit_node_url_aria', { name: site.name })}
                      value={editNodeUrl}
                      onChange={(e) => setEditNodeUrl(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {t('settings_db_analyzer_packet_url_label')}
                    </Label>
                    <Input
                      aria-label={t('settings_db_analyzer_edit_packet_url_aria', {
                        name: site.name,
                      })}
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
                      aria-label={t('settings_db_analyzer_save_aria', { name: site.name })}
                    >
                      {t('settings_db_analyzer_save_button')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingIndex(null)}
                      aria-label={t('settings_db_analyzer_cancel_aria', { name: site.name })}
                    >
                      {t('common_cancel')}
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
                      aria-label={t('settings_db_analyzer_edit_aria', { name: site.name })}
                    >
                      {t('settings_db_analyzer_edit_button')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-destructive/50 text-destructive hover:bg-destructive/10"
                      onClick={() => handleRemoveAnalyzerSite(index)}
                      aria-label={t('settings_db_analyzer_remove_aria', { name: site.name })}
                    >
                      {t('settings_db_analyzer_remove_button')}
                    </Button>
                  </div>
                </li>
              )
            )}
          </ul>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground italic">
            {t('settings_db_analyzer_empty')}
          </p>
        )}

        <div className="rounded-md border border-border p-3 space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor="analyzer-name" className="text-xs text-muted-foreground">
              {t('common_name')}
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
              {t('settings_db_analyzer_node_url_label')}
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
              {t('settings_db_analyzer_packet_url_label')}
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
            {t('settings_db_analyzer_add_button')}
          </Button>
        </div>
      </div>
    </div>
  );
}
