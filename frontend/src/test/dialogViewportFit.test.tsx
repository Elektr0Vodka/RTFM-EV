/**
 * A dialog has to fit the screen it opens on.
 *
 * `DialogContent` is centred with a translate, so content taller than the
 * viewport ran off both edges with nothing to scroll, and the close button went
 * above the top of the screen. jsdom does no layout, so these tests guard the
 * classes that produce the fit, not the resulting pixels.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';

describe('the dialog primitive', () => {
  it('caps its height to the viewport and scrolls what does not fit', () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Tall</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toMatch(/max-h-\[calc\(100dvh/);
    expect(dialog.className).toContain('overflow-y-auto');
  });

  it('leaves a dialog that lays out its own scrolling body alone', () => {
    // Several modals cap themselves and scroll an inner region so their header
    // stays in place. cn() has to resolve to the caller's classes there, not add
    // a second scroll container.
    render(
      <Dialog open>
        <DialogContent
          aria-describedby={undefined}
          className="flex max-h-[80dvh] flex-col overflow-hidden"
        >
          <DialogHeader>
            <DialogTitle>Self-managed</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('overflow-hidden');
    expect(dialog.className).not.toContain('overflow-y-auto');
    expect(dialog.className).toContain('max-h-[80dvh]');
    expect(dialog.className).not.toMatch(/max-h-\[calc\(100dvh/);
  });
});
