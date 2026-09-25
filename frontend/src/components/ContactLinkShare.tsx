import { useState } from 'react';
import { Copy, Link2 } from 'lucide-react';
import type { ContactUriResult } from '../api';
import { useT } from '../i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { toast } from './ui/sonner';

/**
 * Shows a meshcore:// contact link on demand. The link is read from the radio
 * (CMD_EXPORT_CONTACT), which is a local command: nothing is transmitted.
 */
export function ContactLinkShare({
  load,
  hint,
  className = '',
  shareTag,
}: {
  load: () => Promise<ContactUriResult>;
  hint?: string;
  className?: string;
  /**
   * The inline `<pubkey:type:Name>` share tag for this contact. Pasted into a
   * message it gives other MeshCore apps an "Add contact" offer (upstream
   * issue #347). Optional; no button when omitted.
   */
  shareTag?: string;
}) {
  const t = useT();
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleShow = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await load();
      setUri(result.uri);
    } catch (err) {
      setUri(null);
      setError(err instanceof Error && err.message ? err.message : t('contact_link_error'));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!uri) return;
    await navigator.clipboard.writeText(uri);
    toast.success(t('contact_link_copied'));
  };

  const handleCopyTag = async () => {
    if (!shareTag) return;
    await navigator.clipboard.writeText(shareTag);
    toast.success(t('contact_share_tag_copied'));
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center gap-2 text-sm">
        <Link2 className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{t('contact_link_label')}</span>
      </div>
      {uri ? (
        <div className="flex gap-2">
          <Input
            readOnly
            value={uri}
            aria-label={t('contact_link_label')}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void handleCopy()}
            title={t('contact_link_copy')}
            aria-label={t('contact_link_copy')}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleShow()}
          disabled={loading}
        >
          {t('contact_link_show')}
        </Button>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{hint ?? t('contact_link_hint')}</p>
      {shareTag && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleCopyTag()}
            title={shareTag}
          >
            {t('contact_share_tag_copy')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('contact_share_tag_hint')}</span>
        </div>
      )}
    </div>
  );
}
