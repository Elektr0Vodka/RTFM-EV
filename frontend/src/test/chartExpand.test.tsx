import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n/I18nProvider';
import { ZoomableChart, timeRangeOfDomain } from '../components/charts/ZoomableChart';
import { ZoomableBinChart } from '../components/charts/ZoomableBinChart';
import { ExpandableChart, useChartExpanded } from '../components/charts/ChartExpand';

function Probe({ id }: { id: string }) {
  const expanded = useChartExpanded();
  return <div data-testid={id}>{expanded ? 'big' : 'small'}</div>;
}

const wrap = (ui: React.ReactNode) => render(<I18nProvider>{ui}</I18nProvider>);

describe('chart expand panel', () => {
  it('opens a ZoomableChart in a panel with its title and a Share button', () => {
    const child = vi.fn(() => <Probe id="chart" />);
    wrap(
      <ZoomableChart full={[0, 10]} minSpan={2} title="Packets per hour">
        {child}
      </ZoomableChart>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open larger' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Packets per hour');
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    // The panel holds a second instance of the chart, marked as expanded, with no "+" of its own.
    expect(screen.getAllByTestId('chart').map((n) => n.textContent)).toEqual(['small', 'big']);
    expect(screen.getAllByRole('button', { name: 'Open larger', hidden: true })).toHaveLength(1);
  });

  it('starts the panel chart at the inline zoom', () => {
    const domains: number[][] = [];
    wrap(
      <ZoomableChart full={[0, 10]} minSpan={2} title="T">
        {({ domain }) => {
          domains.push(domain);
          return <div />;
        }}
      </ZoomableChart>
    );
    const frame = screen.getByRole('button', { name: 'Open larger' }).parentElement as HTMLElement;
    act(() => {
      frame.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, clientX: 0, cancelable: true }));
    });
    const zoomed = domains[domains.length - 1];
    expect(zoomed[1] - zoomed[0]).toBeLessThan(10);
    fireEvent.click(screen.getByRole('button', { name: 'Open larger' }));
    expect(domains[domains.length - 1]).toEqual(zoomed);
  });

  it('does not start a pan or reset when the "+" is pressed', () => {
    const onDown = vi.fn();
    const onDbl = vi.fn();
    wrap(
      <div onMouseDown={onDown} onDoubleClick={onDbl}>
        <ZoomableChart full={[0, 10]} minSpan={2}>
          {() => <div />}
        </ZoomableChart>
      </div>
    );
    const btn = screen.getByRole('button', { name: 'Open larger' });
    fireEvent.mouseDown(btn);
    fireEvent.doubleClick(btn);
    expect(onDown).not.toHaveBeenCalled();
    expect(onDbl).not.toHaveBeenCalled();
  });

  it('opens a bin chart and an unwrapped chart the same way', () => {
    wrap(
      <>
        <ZoomableBinChart items={[1, 2, 3, 4]} title="Bins">
          {() => <Probe id="bins" />}
        </ZoomableBinChart>
        <ExpandableChart title="Pie" legend={[{ label: 'One byte', color: 'red' }]}>
          <Probe id="pie" />
        </ExpandableChart>
      </>
    );
    const [binsBtn, pieBtn] = screen.getAllByRole('button', { name: 'Open larger' });
    fireEvent.click(binsBtn);
    expect(screen.getByRole('dialog')).toHaveTextContent('Bins');
    expect(screen.getAllByTestId('bins').map((n) => n.textContent)).toEqual(['small', 'big']);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(pieBtn);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Pie');
    expect(dialog).toHaveTextContent('One byte');
  });

  it('reads a time domain as a time range and an index domain as none', () => {
    expect(timeRangeOfDomain([1_700_000_000, 1_700_003_600])).toEqual([
      1_700_000_000, 1_700_003_600,
    ]);
    expect(timeRangeOfDomain([1_700_000_000_000, 1_700_003_600_000])).toEqual([
      1_700_000_000, 1_700_003_600,
    ]);
    expect(timeRangeOfDomain([0, 23])).toBeNull();
  });
});
