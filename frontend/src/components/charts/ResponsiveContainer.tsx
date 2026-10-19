import { ResponsiveContainer as RechartsResponsiveContainer } from 'recharts';
import { expandedChartHeight, useChartExpanded } from './ChartExpand';

type Props = React.ComponentProps<typeof RechartsResponsiveContainer>;

/**
 * Recharts' ResponsiveContainer, but taller inside the large chart panel. A
 * drop-in: charts import this one so the panel can grow them without each
 * chart knowing about it.
 */
export function ResponsiveContainer(props: Props) {
  const expanded = useChartExpanded();
  if (!expanded) return <RechartsResponsiveContainer {...props} />;
  const min = expandedChartHeight();
  const height = typeof props.height === 'number' ? Math.max(props.height, min) : min;
  return <RechartsResponsiveContainer {...props} height={height} />;
}
