import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Copy, Download, ImageUp, Plus, QrCode, Trash2, Users } from 'lucide-react';
import type { Community, CommunityExport } from '../types';
import { api } from '../api';
import { useT } from '../i18n';
import { toast } from './ui/sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';
import { looksLikeCommunityPayload, qrSvgDataUrl, renderQrPng, scanQr } from '../utils/communityQr';

/**
 * meshcore-open communities: join by pasted QR JSON or a scanned QR code, add
 * community hashtag channels, export the community as JSON or QR.
 *
 * Channels are created in the database only (like every other channel here);
 * they are loaded onto the radio at send time. Nothing is transmitted.
 */

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeFilename(name: string): string {
  return name.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'community';
}

const SCAN_INTERVAL_MS = 350;

function CameraScanner({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    let busy = false;
    const canvas = document.createElement('canvas');

    const tick = async () => {
      const video = videoRef.current;
      if (stopped || busy || !video || video.readyState < 2 || !video.videoWidth) return;
      busy = true;
      try {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(video, 0, 0);
        const text = await scanQr(ctx.getImageData(0, 0, canvas.width, canvas.height));
        if (text && !stopped) onResult(text);
      } catch {
        // A frame that fails to decode is normal; keep scanning.
      } finally {
        busy = false;
      }
    };

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t('community_camera_unavailable'));
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play().catch(() => undefined);
        }
        timer = window.setInterval(() => void tick(), SCAN_INTERVAL_MS);
      })
      .catch(() => setError(t('community_camera_denied')));

    return () => {
      stopped = true;
      if (timer !== undefined) window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onResult, t]);

  return (
    <div className="space-y-2 rounded-md border border-border/70 p-2">
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <video
          ref={videoRef}
          className="w-full max-h-64 rounded bg-black object-contain"
          muted
          playsInline
          aria-label={t('community_camera_aria')}
        />
      )}
      <Button type="button" variant="outline" size="sm" onClick={onClose}>
        {t('community_camera_stop')}
      </Button>
    </div>
  );
}

function JoinForm({ onJoined }: { onJoined: (community: Community) => void }) {
  const t = useT();
  const [payload, setPayload] = useState('');
  const [addPublic, setAddPublic] = useState(true);
  const [tryHistorical, setTryHistorical] = useState(true);
  const [joining, setJoining] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleScanned = useCallback(
    (text: string) => {
      setScanning(false);
      setPayload(text);
      if (!looksLikeCommunityPayload(text)) {
        toast.warning(t('community_scan_not_community'));
      } else {
        toast.success(t('community_scan_found'));
      }
    },
    [t]
  );

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setDecoding(true);
    try {
      const text = await scanQr(file);
      if (text) {
        handleScanned(text);
      } else {
        toast.error(t('community_scan_none'));
      }
    } catch (err) {
      toast.error(t('community_scan_failed'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDecoding(false);
    }
  };

  const handleJoin = async () => {
    setJoining(true);
    try {
      const result = await api.joinCommunity(payload.trim(), addPublic, tryHistorical);
      toast.success(
        result.already_joined
          ? t('community_toast_already_joined', { name: result.community.name })
          : t('community_toast_joined', { name: result.community.name }),
        {
          description: result.decrypt_started ? t('channel_io_decrypt_started') : undefined,
        }
      );
      setPayload('');
      onJoined(result.community);
    } catch (err) {
      toast.error(t('community_toast_join_failed'), {
        description: err instanceof Error ? err.message : t('channel_io_unknown_error'),
      });
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('community_join_help')}</p>
      <textarea
        value={payload}
        onChange={(e) => setPayload(e.target.value)}
        rows={3}
        spellCheck={false}
        placeholder={t('community_paste_placeholder')}
        aria-label={t('community_paste_aria')}
        className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setScanning((s) => !s)}
          aria-pressed={scanning}
        >
          <Camera className="h-4 w-4 mr-1.5" aria-hidden="true" />
          {t('community_scan_camera')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={decoding}
        >
          <ImageUp className="h-4 w-4 mr-1.5" aria-hidden="true" />
          {decoding ? t('community_scan_decoding') : t('community_scan_image')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="community-qr-image-input"
          onChange={(e) => void handleImage(e)}
        />
      </div>
      {scanning && <CameraScanner onResult={handleScanned} onClose={() => setScanning(false)} />}
      <label className="flex items-start gap-2 cursor-pointer text-sm">
        <input
          type="checkbox"
          checked={addPublic}
          onChange={(e) => setAddPublic(e.target.checked)}
          className="mt-0.5 rounded"
        />
        <span>{t('community_add_public_label')}</span>
      </label>
      <label className="flex items-start gap-2 cursor-pointer text-sm">
        <input
          type="checkbox"
          checked={tryHistorical}
          onChange={(e) => setTryHistorical(e.target.checked)}
          className="mt-0.5 rounded"
        />
        <div>
          <span>{t('channel_io_decrypt_checkbox_label')}</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('channel_io_decrypt_checkbox_helper')}
          </p>
        </div>
      </label>
      <Button
        type="button"
        onClick={() => void handleJoin()}
        disabled={joining || payload.trim().length === 0}
      >
        {joining ? t('community_joining') : t('community_join_button')}
      </Button>
    </div>
  );
}

function ExportSection({ community }: { community: Community }) {
  const t = useT();
  const [exported, setExported] = useState<CommunityExport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => setExported(null), [community.id]);

  const reveal = async () => {
    setLoading(true);
    try {
      setExported(await api.exportCommunity(community.id));
    } catch (err) {
      toast.error(t('community_toast_export_failed'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  if (!exported) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-warning">{t('community_export_warning')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void reveal()}
          disabled={loading}
        >
          <QrCode className="h-4 w-4 mr-1.5" aria-hidden="true" />
          {t('community_export_show')}
        </Button>
      </div>
    );
  }

  const base = `meshcore_community_${safeFilename(exported.name)}`;
  return (
    <div className="space-y-2">
      <p className="text-xs text-warning">{t('community_export_warning')}</p>
      <img
        src={qrSvgDataUrl(exported.payload)}
        alt={t('community_export_qr_alt', { name: exported.name })}
        className="h-48 w-48 rounded bg-white p-1"
      />
      <div className="flex gap-2">
        <Input
          readOnly
          value={exported.payload}
          aria-label={t('community_export_json_aria')}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          title={t('community_export_copy')}
          aria-label={t('community_export_copy')}
          onClick={() => {
            void navigator.clipboard
              .writeText(exported.payload)
              .then(() => toast.success(t('community_export_copied')));
          }}
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void renderQrPng(exported.payload).then((blob) => downloadBlob(blob, `${base}.png`));
          }}
        >
          <Download className="h-4 w-4 mr-1.5" aria-hidden="true" />
          {t('community_export_png')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            downloadBlob(new Blob([exported.payload], { type: 'application/json' }), `${base}.json`)
          }
        >
          <Download className="h-4 w-4 mr-1.5" aria-hidden="true" />
          {t('community_export_json')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setExported(null)}>
          {t('community_export_hide')}
        </Button>
      </div>
    </div>
  );
}

function CommunityDetail({
  community,
  onUpdated,
  onDeleted,
}: {
  community: Community;
  onUpdated: (community: Community) => void;
  onDeleted: (id: string) => void;
}) {
  const t = useT();
  const [hashtag, setHashtag] = useState('');
  const [tryHistorical, setTryHistorical] = useState(true);
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    setAdding(true);
    try {
      const result = await api.addCommunityHashtag(community.id, hashtag.trim(), tryHistorical);
      toast.success(
        result.created
          ? t('community_toast_hashtag_added', { name: result.channel.name })
          : t('community_toast_hashtag_exists', { name: result.channel.name }),
        { description: result.decrypt_started ? t('channel_io_decrypt_started') : undefined }
      );
      setHashtag('');
      onUpdated(result.community);
    } catch (err) {
      toast.error(t('community_toast_hashtag_failed'), {
        description: err instanceof Error ? err.message : t('channel_io_unknown_error'),
      });
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t('community_confirm_forget', { name: community.name }))) return;
    try {
      await api.deleteCommunity(community.id);
      toast.success(t('community_toast_forgotten', { name: community.name }));
      onDeleted(community.id);
    } catch (err) {
      toast.error(t('community_toast_forget_failed'), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{community.name}</span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {t('community_short_id', { id: community.short_id })}
          </span>
        </div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide mt-2">
          {t('community_channels_heading', { count: community.channels.length })}
        </p>
        {community.channels.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('community_no_channels')}</p>
        ) : (
          <div className="mt-1 rounded-md border border-border/70 divide-y divide-border/40">
            {community.channels.map((c) => (
              <div key={c.key} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  {c.kind === 'public' ? t('community_kind_public') : t('community_kind_hashtag')}
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {c.key.slice(0, 8)}…
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">{t('community_add_hashtag_heading')}</p>
        <div className="flex gap-2">
          <Input
            value={hashtag}
            onChange={(e) => setHashtag(e.target.value)}
            placeholder={t('community_hashtag_placeholder')}
            aria-label={t('community_hashtag_aria')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hashtag.trim()) {
                e.preventDefault();
                void handleAdd();
              }
            }}
          />
          <Button
            type="button"
            onClick={() => void handleAdd()}
            disabled={adding || !hashtag.trim()}
          >
            <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {t('community_add_hashtag_button')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('community_hashtag_help')}</p>
        <label className="flex items-start gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={tryHistorical}
            onChange={(e) => setTryHistorical(e.target.checked)}
            className="mt-0.5 rounded"
          />
          <span>{t('channel_io_decrypt_checkbox_label')}</span>
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">{t('community_export_heading')}</p>
        <ExportSection community={community} />
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive"
        onClick={() => void handleDelete()}
      >
        <Trash2 className="h-4 w-4 mr-1.5" aria-hidden="true" />
        {t('community_forget_button')}
      </Button>
    </div>
  );
}

export function CommunitiesPanel({ onChannelsChanged }: { onChannelsChanged: () => void }) {
  const t = useT();
  const [communities, setCommunities] = useState<Community[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | 'join'>('join');

  const reload = useCallback(async () => {
    try {
      const list = await api.getCommunities();
      setCommunities(list);
      return list;
    } catch (err) {
      toast.error(t('community_toast_load_failed'), {
        description: err instanceof Error ? err.message : undefined,
      });
      setCommunities([]);
      return [];
    }
  }, [t]);

  useEffect(() => {
    void reload().then((list) => {
      if (list.length > 0) setSelectedId(list[0].id);
    });
  }, [reload]);

  const upsert = (community: Community) => {
    setCommunities((prev) => {
      const rest = (prev ?? []).filter((c) => c.id !== community.id);
      return [...rest, community].sort((a, b) => a.name.localeCompare(b.name));
    });
    setSelectedId(community.id);
    onChannelsChanged();
  };

  const selected = communities?.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('community_intro')}</p>
      <div className="flex flex-wrap gap-1.5">
        {(communities ?? []).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setSelectedId(c.id)}
            className={cn(
              'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
              selectedId === c.id
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <Users className="h-3 w-3" aria-hidden="true" />
            {c.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSelectedId('join')}
          className={cn(
            'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
            selectedId === 'join'
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          )}
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          {t('community_join_tab')}
        </button>
      </div>

      {communities === null ? (
        <p className="text-sm text-muted-foreground">{t('community_loading')}</p>
      ) : selected ? (
        <CommunityDetail
          community={selected}
          onUpdated={upsert}
          onDeleted={(id) => {
            setCommunities((prev) => (prev ?? []).filter((c) => c.id !== id));
            setSelectedId('join');
          }}
        />
      ) : (
        <JoinForm onJoined={upsert} />
      )}
    </div>
  );
}
