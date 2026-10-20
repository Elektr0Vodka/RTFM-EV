import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const caps = { secure: true, share: true, copy: true };
const copyPng = vi.fn().mockResolvedValue(undefined);
const shareFile = vi.fn().mockResolvedValue('shared');
const downloadBlob = vi.fn();

vi.mock('../../share/shareActions', () => ({
  getShareCapabilities: () => ({
    secure: caps.secure,
    canShareFiles: () => caps.secure && caps.share,
    canCopyImage: caps.secure && caps.copy,
  }),
  copyPng: (b: Blob) => copyPng(b),
  shareFile: (f: File, t: string) => shareFile(f, t),
  downloadBlob: (b: Blob, n: string) => downloadBlob(b, n),
}));

const framingMap = {
  getSource: () => undefined,
  addSource: () => {},
  addLayer: () => {},
  getCenter: () => ({ lat: 52.3, lng: 5.2 }),
  getZoom: () => 11,
  getContainer: () => ({ clientWidth: 345 }),
};
vi.mock('../../map/MiniMap', async () => {
  const { useEffect } = await import('react');
  return {
    MiniMap: ({ onReady }: { onReady?: (m: unknown) => void }) => {
      useEffect(() => onReady?.(framingMap), [onReady]);
      return <div data-testid="framing-map" />;
    },
  };
});

import { I18nProvider } from '../../i18n/I18nProvider';
import { ShareCardDialog, type ShareCardResult } from '../../share/ShareCardDialog';
import { BasemapLoadError } from '../../share/basemapCapture';
import { getHidePosition, setHidePosition } from '../../share/hidePosition';

const png = new Blob(['png'], { type: 'image/png' });
const gifBlob = new Blob(['gif'], { type: 'image/gif' });

function result(over: Partial<ShareCardResult> = {}): ShareCardResult {
  return {
    png,
    gif: () => Promise.resolve(gifBlob),
    filenameBase: 'rtfm-ev-message-2026-10-18-2114',
    alt: 'Map of a message',
    shareTitle: 'A message',
    ...over,
  };
}

function renderDialog(
  build: (o: unknown) => Promise<ShareCardResult>,
  supportsHidePosition = false
) {
  return render(
    <I18nProvider>
      <ShareCardDialog
        open
        onClose={() => {}}
        title="Share as image"
        supportsHidePosition={supportsHidePosition}
        build={build}
      />
    </I18nProvider>
  );
}

beforeEach(() => {
  caps.secure = true;
  caps.share = true;
  caps.copy = true;
  vi.clearAllMocks();
  localStorage.clear();
  // Still a URL class (the lazy framing map's import needs one), with blob URLs stubbed.
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ShareCardDialog framing', () => {
  function renderFramed(build: (o: unknown) => Promise<ShareCardResult>) {
    return render(
      <I18nProvider>
        <ShareCardDialog
          open
          onClose={() => {}}
          title="Drive card"
          supportsHidePosition
          framing={{
            located: [
              { lat: 52, lon: 5 },
              { lat: 52.5, lon: 5.5 },
            ],
          }}
          build={build}
        />
      </I18nProvider>
    );
  }

  it('builds with the view framed on a map, scaled to the card', async () => {
    const build = vi.fn().mockResolvedValue(result());
    renderFramed(build);
    await screen.findByRole('button', { name: 'Download image' });
    expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ view: null }));
    await userEvent.click(screen.getByRole('button', { name: 'Frame the map' }));
    expect(await screen.findByTestId('framing-map')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use this view' }));
    // The framing map is 345 px wide, the card's map 690 px: one zoom level more.
    await waitFor(() =>
      expect(build).toHaveBeenLastCalledWith(
        expect.objectContaining({ view: { center: { lat: 52.3, lon: 5.2 }, zoom: 12 } })
      )
    );
    expect(screen.queryByTestId('framing-map')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Fit to the data' }));
    await waitFor(() =>
      expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ view: null }))
    );
  });

  it('offers no framing without a map', async () => {
    const build = vi.fn().mockResolvedValue(result());
    renderFramed(build);
    await screen.findByRole('button', { name: 'Download image' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Hide my position' }));
    await waitFor(() =>
      expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ hidePosition: true }))
    );
    expect(screen.queryByRole('button', { name: 'Frame the map' })).toBeNull();
  });
});

describe('ShareCardDialog', () => {
  it('shows the insecure note and no Share or Copy on plain http', async () => {
    caps.secure = false;
    renderDialog(() => Promise.resolve(result()));
    expect(await screen.findByText(/need https or localhost/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy image' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Download image' })).toBeEnabled();
  });

  it('offers Share and Copy in a secure context', async () => {
    renderDialog(() => Promise.resolve(result()));
    expect(await screen.findByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy image' })).toBeInTheDocument();
    expect(screen.queryByText(/need https or localhost/)).toBeNull();
  });

  it('offers Make it without the map after a basemap failure and rebuilds with noMap', async () => {
    const build = vi.fn().mockRejectedValueOnce(new BasemapLoadError()).mockResolvedValue(result());
    renderDialog(build);
    expect(await screen.findByText(/The map did not load/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Make it without the map' }));
    await waitFor(() =>
      expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ noMap: true }))
    );
    expect(await screen.findByRole('button', { name: 'Download image' })).toBeInTheDocument();
  });

  it('rebuilds with hidePosition when the toggle is turned on and remembers it', async () => {
    const build = vi.fn().mockResolvedValue(result());
    renderDialog(build, true);
    await screen.findByRole('button', { name: 'Download image' });
    expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ hidePosition: false }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Hide my position' }));
    await waitFor(() =>
      expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ hidePosition: true }))
    );
    expect(getHidePosition()).toBe(true);
  });

  it('starts with the remembered hide-position choice', async () => {
    setHidePosition(true);
    const build = vi.fn().mockResolvedValue(result());
    renderDialog(build, true);
    await waitFor(() =>
      expect(build).toHaveBeenCalledWith(expect.objectContaining({ hidePosition: true }))
    );
  });

  it('Copy image writes the PNG even when a GIF exists', async () => {
    renderDialog(() => Promise.resolve(result()));
    await screen.findByRole('button', { name: 'Download animation' });
    await userEvent.click(screen.getByRole('button', { name: 'Copy image' }));
    expect(copyPng).toHaveBeenCalledWith(png);
  });

  it('Share sends the GIF once it is ready', async () => {
    renderDialog(() => Promise.resolve(result()));
    await screen.findByRole('button', { name: 'Download animation' });
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    const [file, title] = shareFile.mock.calls[0] as [File, string];
    expect(file.name).toBe('rtfm-ev-message-2026-10-18-2114.gif');
    expect(title).toBe('A message');
  });

  it('Download animation appears only after the GIF is ready', async () => {
    let finish: (b: Blob) => void = () => {};
    const gif = () => new Promise<Blob>((r) => (finish = r));
    renderDialog(() => Promise.resolve(result({ gif })));
    await screen.findByRole('button', { name: 'Download image' });
    expect(screen.getByText('Making the animation…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download animation' })).toBeNull();
    finish(gifBlob);
    await userEvent.click(await screen.findByRole('button', { name: 'Download animation' }));
    expect(downloadBlob).toHaveBeenCalledWith(gifBlob, 'rtfm-ev-message-2026-10-18-2114.gif');
  });

  it('keeps the PNG and shows a message when the GIF fails', async () => {
    renderDialog(() => Promise.resolve(result({ gif: () => Promise.reject(new Error('x')) })));
    expect(await screen.findByText(/Could not make the animation/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download image' }));
    expect(downloadBlob).toHaveBeenCalledWith(png, 'rtfm-ev-message-2026-10-18-2114.png');
    expect(screen.queryByRole('button', { name: 'Download animation' })).toBeNull();
  });

  it('aborts a GIF that is still being made when the dialog closes', async () => {
    let seen: AbortSignal | undefined;
    const gif = (signal?: AbortSignal) => {
      seen = signal;
      return new Promise<Blob>(() => {});
    };
    const { unmount } = renderDialog(() => Promise.resolve(result({ gif })));
    await screen.findByText('Making the animation…');
    expect(seen?.aborted).toBe(false);
    unmount();
    expect(seen?.aborted).toBe(true);
  });

  it('shows a generic error for other failures', async () => {
    renderDialog(() => Promise.reject(new Error('boom')));
    expect(await screen.findByText('Could not make the image.')).toBeInTheDocument();
  });
});
