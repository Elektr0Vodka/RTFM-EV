import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { SvgZoomFrame } from '../components/charts/SvgZoomFrame';
import type { ChartWindow } from '../lib/chartZoom';

// jsdom has no layout, so getBoundingClientRect() is all zeros: the cursor
// fraction resolves to 0 (left edge) and the anchored value stays at the left,
// which keeps these assertions deterministic.

function setup(view: ChartWindow, onChange = vi.fn()) {
  const utils = render(
    <SvgZoomFrame full={[0, 10]} view={view} onChange={onChange} minSpan={2}>
      <div data-testid="child">chart</div>
    </SvgZoomFrame>
  );
  const frame = utils.getByTestId('child').parentElement as HTMLElement;
  return { frame, onChange, ...utils };
}

describe('SvgZoomFrame', () => {
  it('narrows the window on wheel-up (zoom in)', () => {
    const { frame, onChange } = setup([0, 10]);
    frame.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, clientX: 0, cancelable: true }));
    expect(onChange).toHaveBeenCalledWith([0, 8]);
  });

  it('widens the window on wheel-down (zoom out)', () => {
    const { frame, onChange } = setup([2, 6]);
    frame.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, clientX: 0, cancelable: true }));
    const arg = onChange.mock.calls[0][0] as ChartWindow;
    expect(arg[1] - arg[0]).toBeGreaterThan(4);
  });

  it('resets to full on double-click', () => {
    const { frame, onChange } = setup([3, 5]);
    fireEvent.doubleClick(frame);
    expect(onChange).toHaveBeenCalledWith([0, 10]);
  });

  it('does not bind zoom when the full range is below the minimum span', () => {
    const onChange = vi.fn();
    const { getByTestId } = render(
      <SvgZoomFrame full={[0, 1]} view={[0, 1]} onChange={onChange} minSpan={2}>
        <div data-testid="child">chart</div>
      </SvgZoomFrame>
    );
    const frame = getByTestId('child').parentElement as HTMLElement;
    frame.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, clientX: 0, cancelable: true }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
