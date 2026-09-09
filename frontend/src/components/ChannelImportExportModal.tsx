import { useCallback, useRef, useState } from 'react';
import { Upload, Download, FileText, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import type { Channel, ChannelImportResult } from '../types';
import { api } from '../api';
import { toast } from './ui/sonner';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CrackerFoundChannel {
  name: string;
  key: string;
}

export interface ChannelImportExportModalProps {
  open: boolean;
  onClose: () => void;
  channels: Channel[];
  crackerFoundChannels: CrackerFoundChannel[];
  onChannelsImported: (channels: Channel[]) => void;
}

type ExportMode = 'all' | 'selected' | 'finder';
type TabId = 'export' | 'import';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatExportContent(channels: Channel[], _label: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `# MeshCore Channel Export - ${date}`,
    '# Format: #channel-name - 32-char-hex-key',
    '# Import this file in Remote Terminal for MeshCore via Channels → Import',
    '',
  ];
  for (const c of channels) {
    const name = c.name.startsWith('#') ? c.name : `#${c.name}`;
    lines.push(`${name} - ${c.key.toLowerCase()}`);
  }
  return lines.join('\n') + '\n';
}

function triggerDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface ParsedImportLine {
  name: string;
  key: string;
  isNew: boolean;
}

function parseImportFile(
  text: string,
  existingKeys: Set<string>
): {
  valid: ParsedImportLine[];
  invalid: string[];
} {
  const valid: ParsedImportLine[] = [];
  const invalid: string[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#') && !line.includes(' - ')) continue; // comment

    if (!line.includes(' - ')) {
      invalid.push(line);
      continue;
    }
    const [namePart, keyPart] = line.split(' - ', 2);
    const key = keyPart?.trim().toLowerCase() ?? '';

    if (key.length !== 32 || !/^[0-9a-f]+$/i.test(key)) {
      invalid.push(line);
      continue;
    }
    const name = namePart.trim();
    valid.push({
      name: name.startsWith('#') ? name : `#${name}`,
      key,
      isNew: !existingKeys.has(key.toUpperCase()),
    });
  }
  return { valid, invalid };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChannelImportExportModal({
  open,
  onClose,
  channels,
  crackerFoundChannels,
  onChannelsImported,
}: ChannelImportExportModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('export');

  // ── Export state ──────────────────────────────────────────────────────────
  const [exportMode, setExportMode] = useState<ExportMode>('all');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const toggleSelected = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedKeys.size === channels.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(channels.map((c) => c.key)));
    }
  };

  const handleExport = () => {
    let toExport: Channel[];
    let suffix: string;

    if (exportMode === 'all') {
      toExport = channels;
      suffix = 'all';
    } else if (exportMode === 'selected') {
      toExport = channels.filter((c) => selectedKeys.has(c.key));
      if (toExport.length === 0) {
        toast.warning('No channels selected', {
          description: 'Select at least one channel to export.',
        });
        return;
      }
      suffix = 'selected';
    } else {
      // finder
      toExport = crackerFoundChannels.map((cf) => ({
        key: cf.key.toUpperCase(),
        name: cf.name.startsWith('#') ? cf.name : `#${cf.name}`,
        is_hashtag: true,
        on_radio: false,
        flood_scope_override: null,
        path_hash_mode_override: null,
        last_read_at: null,
        favorite: false,
        muted: false,
      }));
      if (toExport.length === 0) {
        toast.warning('No channels found yet', {
          description: 'Run the Room Finder to discover channels first.',
        });
        return;
      }
      suffix = 'finder';
    }

    const date = new Date().toISOString().slice(0, 10);
    const content = formatExportContent(toExport, suffix);
    triggerDownload(content, `meshcore_channels_${date}_${suffix}.txt`);
    toast.success(`Exported ${toExport.length} channel${toExport.length !== 1 ? 's' : ''}`);
  };

  // ── Import state ──────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [parsedLines, setParsedLines] = useState<ParsedImportLine[] | null>(null);
  const [invalidLines, setInvalidLines] = useState<string[]>([]);
  const [tryHistorical, setTryHistorical] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ChannelImportResult | null>(null);

  const existingKeys = new Set(channels.map((c) => c.key.toUpperCase()));

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setImportFile(file);
      setImportResult(null);

      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const { valid, invalid } = parseImportFile(text, existingKeys);
        setParsedLines(valid);
        setInvalidLines(invalid);
      };
      reader.readAsText(file);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channels]
  );

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const result = await api.importChannels(importFile, tryHistorical);
      setImportResult(result);
      onChannelsImported(result.imported_channels);
      toast.success('Import complete', { description: result.message });
    } catch (err) {
      toast.error('Import failed', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setImporting(false);
    }
  };

  const resetImport = () => {
    setImportFile(null);
    setParsedLines(null);
    setInvalidLines([]);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const newCount = parsedLines?.filter((l) => l.isNew).length ?? 0;
  const dupCount = parsedLines?.filter((l) => !l.isNew).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Channel Import / Export</DialogTitle>
          <DialogDescription>
            Export your channels as a shareable text file or import channels from one.
          </DialogDescription>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex border-b border-border -mx-6 px-6">
          {(['export', 'import'] as TabId[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors focus-visible:outline-none',
                activeTab === tab
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab === 'export' ? (
                <span className="flex items-center gap-1.5">
                  <Download className="h-3.5 w-3.5" />
                  Export
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Upload className="h-3.5 w-3.5" />
                  Import
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* ── Export tab ──────────────────────────────────────────────── */}
          {activeTab === 'export' && (
            <>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Choose which channels to include:</p>
                <div className="space-y-1.5">
                  {[
                    {
                      id: 'all' as ExportMode,
                      label: `All channels`,
                      sub: `${channels.length} total`,
                    },
                    {
                      id: 'selected' as ExportMode,
                      label: 'Selected channels',
                      sub: `${selectedKeys.size} selected`,
                    },
                    {
                      id: 'finder' as ExportMode,
                      label: 'Found by Room Finder (this session)',
                      sub:
                        crackerFoundChannels.length === 0
                          ? 'No channels found yet'
                          : `${crackerFoundChannels.length} discovered`,
                    },
                  ].map(({ id, label, sub }) => (
                    <label key={id} className="flex items-start gap-2.5 cursor-pointer group">
                      <input
                        type="radio"
                        name="exportMode"
                        value={id}
                        checked={exportMode === id}
                        onChange={() => setExportMode(id)}
                        className="mt-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium">{label}</span>
                        <span className="text-xs text-muted-foreground ml-2">{sub}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Channel selection list (only when 'selected') */}
              {exportMode === 'selected' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">
                      Channels
                    </span>
                    <button onClick={toggleAll} className="text-xs text-primary hover:underline">
                      {selectedKeys.size === channels.length ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border/70 divide-y divide-border/40">
                    {channels.map((c) => (
                      <label
                        key={c.key}
                        className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-accent/50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(c.key)}
                          onChange={() => toggleSelected(c.key)}
                          className="rounded"
                        />
                        <span className="text-sm flex-1 truncate">{c.name}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {c.key.slice(0, 8)}…
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Finder list preview */}
              {exportMode === 'finder' && crackerFoundChannels.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-md border border-border/70 divide-y divide-border/40">
                  {crackerFoundChannels.map((c) => (
                    <div key={c.key} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <span className="text-success font-medium">
                        {c.name.startsWith('#') ? c.name : `#${c.name}`}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono ml-auto">
                        {c.key.slice(0, 8)}…
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Format:{' '}
                <code className="font-mono bg-muted px-1 rounded">#channel-name - hex-key</code> —
                one channel per line.
              </p>
            </>
          )}

          {/* ── Import tab ──────────────────────────────────────────────── */}
          {activeTab === 'import' && (
            <>
              {importResult ? (
                /* Result view */
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-center">
                      <CheckCircle2 className="h-4 w-4 text-success mx-auto mb-1" />
                      <div className="font-medium">{importResult.imported_channels.length}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        Imported
                      </div>
                    </div>
                    <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-center">
                      <AlertCircle className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
                      <div className="font-medium">{importResult.duplicate_count}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        Already present
                      </div>
                    </div>
                    <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-center">
                      <XCircle className="h-4 w-4 text-destructive mx-auto mb-1" />
                      <div className="font-medium">{importResult.invalid_lines.length}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        Invalid
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{importResult.message}</p>
                  {importResult.decrypt_started && (
                    <p className="text-xs text-success">
                      Historical packet decryption started in background.
                    </p>
                  )}
                  {importResult.invalid_lines.length > 0 && (
                    <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                      Skipped invalid lines: {importResult.invalid_lines.join(', ')}
                    </div>
                  )}
                  <Button variant="outline" size="sm" onClick={resetImport}>
                    Import another file
                  </Button>
                </div>
              ) : (
                /* File picker + preview */
                <div className="space-y-3">
                  <div
                    className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border/60 px-4 py-6 cursor-pointer hover:border-border hover:bg-accent/20 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    aria-label="Select channel file to import"
                  >
                    <FileText className="h-6 w-6 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground text-center">
                      {importFile ? importFile.name : 'Click to select a .txt file'}
                    </p>
                    {!importFile && (
                      <p className="text-xs text-muted-foreground/70 text-center">
                        Format: <code className="font-mono">{'#name - hex-key'}</code> per line
                      </p>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,text/plain"
                    className="hidden"
                    onChange={handleFileChange}
                  />

                  {parsedLines !== null && (
                    <>
                      {/* Summary counts */}
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div className="rounded-md border border-border/70 bg-muted/30 px-2 py-1.5 text-center">
                          <div className="font-medium text-success">{newCount}</div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                            New
                          </div>
                        </div>
                        <div className="rounded-md border border-border/70 bg-muted/30 px-2 py-1.5 text-center">
                          <div className="font-medium text-muted-foreground">{dupCount}</div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                            Already present
                          </div>
                        </div>
                        <div className="rounded-md border border-border/70 bg-muted/30 px-2 py-1.5 text-center">
                          <div className="font-medium text-destructive">{invalidLines.length}</div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                            Invalid
                          </div>
                        </div>
                      </div>

                      {/* Preview list (new only) */}
                      {newCount > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground uppercase tracking-wide">
                            Channels to add ({newCount})
                          </p>
                          <div className="max-h-36 overflow-y-auto rounded-md border border-border/70 divide-y divide-border/40">
                            {parsedLines
                              .filter((l) => l.isNew)
                              .map((l) => (
                                <div
                                  key={l.key}
                                  className="flex items-center gap-2 px-3 py-1.5 text-sm"
                                >
                                  <span className="font-medium flex-1 truncate">{l.name}</span>
                                  <span className="text-[10px] text-muted-foreground font-mono">
                                    {l.key.slice(0, 8)}…
                                  </span>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}

                      <label className="flex items-start gap-2 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={tryHistorical}
                          onChange={(e) => setTryHistorical(e.target.checked)}
                          className="mt-0.5 rounded"
                        />
                        <div>
                          <span>Decrypt stored packets with imported keys</span>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Runs a background sweep to recover messages already received but not yet
                            decrypted.
                          </p>
                        </div>
                      </label>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          {activeTab === 'export' ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleExport}>
                <Download className="h-4 w-4 mr-1.5" />
                Export
              </Button>
            </>
          ) : importResult ? (
            <Button onClick={onClose}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={!importFile || newCount === 0 || importing}>
                {importing
                  ? 'Importing…'
                  : `Import ${newCount} channel${newCount !== 1 ? 's' : ''}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
