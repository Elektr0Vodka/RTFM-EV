import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { SvgZoomBox } from '../components/charts/SvgZoomBox';
import type { ChartBox } from '../lib/chartZoom2d';

// jsdom has no layout, so getBoundingClientRect() is all zeros: the cursor
// resolves to the plot centre (fracX = fracY = 0.5), keeping assertions
// deterministic while still exercising both axes.

const FULL: ChartBox = { x: [0, 10], y: [-20, 0] };

function setup(view: ChartBox, onChange = vi.fn()) {
  const utils = render(
    <SvgZoomBox full={FULL} view={view} onChange={onChange}>
      <div data-testid="child">scatter</div>
    </SvgZoomBox>
  );
  const frame = utils.getByTestId('child').parentElement as HTMLElement;
  return { frame, onChange, ...utils };
}

describe('SvgZoomBox', () => {
  it('zooms both axes in on wheel-up, anchored at the plot centre', () => {
    const { frame, onChange } = setup(FULL);
    frame.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -1, clientX: 0, clientY: 0, cancelable: true })
    );
    expect(onChange).toHaveBeenCalledWith({ x: [1, 9], y: [-18, -2] });
  });

  it('zooms both axes out on wheel-down', () => {
    const { frame, onChange } = setup({ x: [2, 6], y: [-12, -8] });
    frame.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 1, clientX: 0, clientY: 0, cancelable: true })
    );
    const arg = onChange.mock.calls[0][0] as ChartBox;
    expect(arg.x[1] - arg.x[0]).toBeGreaterThan(4);
    expect(arg.y[1] - arg.y[0]).toBeGreaterThan(4);
  });

  it('resets to the full box on double-click', () => {
    const { frame, onChange } = setup({ x: [3, 5], y: [-10, -6] });
    fireEvent.doubleClick(frame);
    expect(onChange).toHaveBeenCalledWith(FULL);
  });

  it('does not bind zoom when an axis has zero span', () => {
    const onChange = vi.fn();
    const { getByTestId } = render(
      <SvgZoomBox
        full={{ x: [0, 0], y: [-20, 0] }}
        view={{ x: [0, 0], y: [-20, 0] }}
        onChange={onChange}
      >
        <div data-testid="child">scatter</div>
      </SvgZoomBox>
    );
    const frame = getByTestId('child').parentElement as HTMLElement;
    frame.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -1, clientX: 0, clientY: 0, cancelable: true })
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
