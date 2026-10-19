// Keeps the wardrive screen up when the map fails (its chunk did not download
// on a poor connection, or WebGL broke): the HUD, Stop and the notes stay, and
// the map area offers a retry.
import { Component, type ReactNode } from 'react';

import { Button } from '../../components/ui/button';
import { useT } from '../../i18n';

function MapFailed({ onRetry }: { onRetry(): void }) {
  const t = useT();
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted text-sm">
      <p>{t('wardrive_page_map_retry')}</p>
      <Button type="button" variant="outline" onClick={onRetry}>
        {t('wardrive_page_retry')}
      </Button>
    </div>
  );
}

interface Props {
  onRetry(): void;
  children: ReactNode;
}

export class MapErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  retry = () => {
    this.setState({ failed: false });
    this.props.onRetry();
  };

  render() {
    return this.state.failed ? <MapFailed onRetry={this.retry} /> : this.props.children;
  }
}
