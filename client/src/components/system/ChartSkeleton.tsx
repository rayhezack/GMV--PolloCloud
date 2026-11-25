/** Placeholder geometry only; no invented dates or metric values while data is loading. */
export function ChartSkeleton({ label = '正在读取图表数据' }: { label?: string }) {
  return (
    <div className="sys-chart-skeleton" role="status" aria-label={label}>
      <svg viewBox="0 0 640 224" preserveAspectRatio="none" aria-hidden="true">
        <g className="sys-chart-skeleton-grid">
          <path d="M24 20H616 M24 76H616 M24 132H616 M24 188H616" />
          <path d="M24 20V188 M172 20V188 M320 20V188 M468 20V188 M616 20V188" />
        </g>
        <g className="sys-chart-skeleton-series">
          <path d="M24 144L64 152L104 126L144 138L184 98L224 112L264 86L304 104L344 74L384 90L424 62L464 80L504 46L544 58L584 36L616 48" />
          <path d="M24 164L64 148L104 156L144 128L184 142L224 124L264 138L304 108L344 122L384 104L424 118L464 92L504 106L544 84L584 98L616 76" />
        </g>
        <g className="sys-chart-skeleton-labels">
          <rect x="24" y="208" width="40" height="8" rx="4" />
          <rect x="300" y="208" width="40" height="8" rx="4" />
          <rect x="576" y="208" width="40" height="8" rx="4" />
        </g>
      </svg>
    </div>
  );
}
