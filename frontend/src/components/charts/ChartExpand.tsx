import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Share2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { toast } from '../ui/sonner';
import { useT } from '../../i18n';
import { ShareCardDialog } from '../../share/ShareCardDialog';
import {
  captureChart,
  type ChartLegendItem,
  type ChartSnapshot,
  type PlotFrac,
} from '../../share/cards/chartCapture';
import { useChartShareBuild, type ChartTimeRange } from '../../share/cards/useChartShare';

// The "+" on every chart opens the same chart in a large panel, with the same
// zoom / pan / tooltip controls, and a Share button that makes an animated
// image of what the panel shows. The zoom wrappers (ZoomableChart,
// ZoomableBinChart) carry the button themselves; any other chart is wrapped in
// <ExpandableChart>. Inside the panel the wrappers report what they
// show (time range, plot area) so the share card can play it.

export interface ChartPanelReport {
  timeRange?: ChartTimeRange | null;
  plot?: PlotFrac;
}

interface PanelContextValue {
  report: (r: ChartPanelReport) => void;
}

const ChartPanelContext = createContext<PanelContextValue | null>(null);

/** True inside the large panel: no "+" there, and charts may grow taller. */
export function useChartExpanded(): boolean {
  return useContext(ChartPanelContext) != null;
}

/** Inside the panel, tells it the time range / plot area the chart shows now. */
export function useChartPanelReport(r: ChartPanelReport | null): void {
  const ctx = useContext(ChartPanelContext);
  const from = r?.timeRange?.[0];
  const to = r?.timeRange?.[1];
  const plot = r?.plot;
  const hasRange = r?.timeRange !== undefined;
  useEffect(() => {
    if (!ctx || !r) return;
    const next: ChartPanelReport = {};
    if (hasRange) next.timeRange = from != null && to != null ? [from, to] : null;
    if (plot) next.plot = plot;
    ctx.report(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, from, to, hasRange, plot?.left, plot?.top, plot?.width, plot?.height]);
}

/** Height a chart gets in the panel (a Recharts container keeps a taller one). */
export function expandedChartHeight(): number {
  const h = typeof window !== 'undefined' ? window.innerHeight : 800;
  return Math.round(Math.max(260, Math.min(520, h * 0.55)));
}

export function ChartExpandButton({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t('chart_expand')}
      title={t('chart_expand')}
      className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded border border-border bg-background/80 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
      // The chart under it pans on mouse down and resets on double click.
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <Plus className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** A CSS colour such as hsl(var(--info)) as the browser resolves it (a canvas cannot). */
function resolveColor(el: HTMLElement, color: string): string {
  const probe = document.createElement('span');
  probe.style.color = color;
  el.appendChild(probe);
  const out = getComputedStyle(probe).color;
  probe.remove();
  return out || color;
}

function ChartLegendRow({ items }: { items: ChartLegendItem[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/**
 * The large panel. `children` is the chart again (a second instance, or the
 * same element for a chart whose zoom its parent owns). `initial` is what a
 * chart without its own report shows (time range, plot area).
 */
export function ChartPanelDialog({
  open,
  onClose,
  title,
  zoomable,
  initial,
  legend,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  zoomable: boolean;
  initial?: ChartPanelReport;
  /** A legend the chart draws outside itself; shown under the panel chart and on the image. */
  legend?: ChartLegendItem[];
  children: React.ReactNode;
}) {
  const t = useT();
  const contentRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<ChartPanelReport>(initial ?? {});
  const ctx = useMemo<PanelContextValue>(
    () => ({ report: (r) => void (reportRef.current = { ...reportRef.current, ...r }) }),
    []
  );
  // A chart without its own report (ExpandableChart) passes what it shows now.
  const iFrom = initial?.timeRange?.[0];
  const iTo = initial?.timeRange?.[1];
  const iPlot = initial?.plot;
  useEffect(() => {
    if (iFrom != null && iTo != null) ctx.report({ timeRange: [iFrom, iTo] });
    if (iPlot) ctx.report({ plot: iPlot });
  }, [ctx, iFrom, iTo, iPlot]);
  const [share, setShare] = useState<{
    snap: ChartSnapshot;
    range: ChartTimeRange | null;
  } | null>(null);
  const build = useChartShareBuild(share?.snap ?? null, title, share?.range ?? null);

  const onShare = () => {
    const el = contentRef.current;
    const snap = el ? captureChart(el, reportRef.current.plot) : null;
    if (!snap) {
      toast.error(t('share_error'));
      return;
    }
    if (snap.legend.length === 0 && legend && el) {
      snap.legend = legend.map((it) => ({ ...it, color: resolveColor(el, it.color) }));
    }
    setShare({ snap, range: reportRef.current.timeRange ?? null });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="w-full max-w-[95vw] sm:max-w-5xl max-h-[90dvh] flex flex-col gap-3 overflow-y-auto p-4 sm:p-6"
        // Portalled, but React events still bubble to the inline chart (pan, reset).
        onMouseDown={stop}
        onPointerDown={stop}
        onClick={stop}
        onDoubleClick={stop}
        {...(zoomable ? {} : { 'aria-describedby': undefined })}
      >
        <DialogHeader className="flex-row items-center gap-3 space-y-0 pr-8">
          <DialogTitle className="min-w-0 flex-1 truncate">{title}</DialogTitle>
          <Button type="button" size="sm" variant="outline" onClick={onShare}>
            <Share2 className="mr-1.5 h-4 w-4" aria-hidden />
            {t('share_action')}
          </Button>
        </DialogHeader>
        {zoomable && (
          <DialogDescription className="text-xs">{t('chart_zoom_hint')}</DialogDescription>
        )}
        <div ref={contentRef} className="min-w-0">
          <ChartPanelContext.Provider value={ctx}>{children}</ChartPanelContext.Provider>
        </div>
        {legend && legend.length > 0 && <ChartLegendRow items={legend} />}
        {share && (
          <ShareCardDialog
            open
            onClose={() => setShare(null)}
            title={t('share_chart_title')}
            supportsHidePosition={false}
            build={build}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Adds the "+" and the panel to a chart that has no zoom wrapper. Inside the
 * panel it renders the chart as is.
 */
export function ExpandableChart({
  title,
  timeRange,
  plot,
  legend,
  className,
  children,
}: {
  title: string;
  legend?: ChartLegendItem[];
  /** Unix seconds the chart covers, for the share animation's clock. */
  timeRange?: ChartTimeRange | null;
  /** Plot area of a custom SVG chart (Recharts charts carry their own). */
  plot?: PlotFrac;
  className?: string;
  children: React.ReactNode;
}) {
  const expanded = useChartExpanded();
  const [open, setOpen] = useState(false);
  if (expanded) return <>{children}</>;
  return (
    <>
      <div className={className ? `relative ${className}` : 'relative'}>
        {children}
        <ChartExpandButton onOpen={() => setOpen(true)} />
      </div>
      {open && (
        <ChartPanelDialog
          open
          onClose={() => setOpen(false)}
          title={title}
          zoomable={false}
          initial={{ timeRange: timeRange ?? null, plot }}
          legend={legend}
        >
          {children}
        </ChartPanelDialog>
      )}
    </>
  );
}
