import React, { useEffect, useMemo, useRef } from 'react';
import { PanelProps } from '@grafana/data';
import { useTheme2, useStyles2, CustomScrollbar } from '@grafana/ui';
import { MatrixOptions } from './types';
import { parseData } from './dataParser';
import { createViz } from './createViz';
import { getStyles } from './tooltip';

export const MatrixPanel: React.FC<PanelProps<MatrixOptions>> = ({ options, data, width, id }) => {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);
  const ref = useRef<HTMLDivElement>(null);

  const parsedData = useMemo(() => parseData(data, options, theme), [data, options, theme]);

  useEffect(() => {
    if (!ref.current || !parsedData.data || typeof parsedData.data === 'string') {
      return;
    }
    createViz(ref.current, id, width, parsedData, options, theme, styles);
  }, [id, width, parsedData, options, theme, styles]);

  if (typeof parsedData.data === 'string') {
    switch (parsedData.data) {
      case 'too many inputs':
        return <div>Too many data points! Try adding limits to your query.</div>;
      default:
        return <div>Unknown Error</div>;
    }
  }

  if (parsedData.data === null) {
    return <div>No Data</div>;
  }

  return (
    <CustomScrollbar autoHeightMin="100%">
      <div ref={ref} id={`matrix-panel-${id}`} style={{ width: '100%' }} />
    </CustomScrollbar>
  );
};
