import type { ReactNode } from 'react';
import { Table, proportional } from '@astryxdesign/core/Table';
export type DataRow = Record<string, unknown> & { id: string; kind?: 'total' | 'row' | 'child' | 'residual' };
export type DataColumn<T> = {
  key: string;
  header: ReactNode;
  numeric?: boolean;
  minWidth?: number;
  sortable?: boolean;
  onSort?: () => void;
  render: (row: T) => ReactNode;
};
/** <DataTable rows={rows} columns={[{key:'gmv',header:'GMV',numeric:true,render:r=>money(r.gmv)}]}/> */
export function DataTable<T extends DataRow>({
  rows,
  columns,
  stickyFirst = false,
  onRowHover,
  onRowActivate,
  selectedRowId,
}: {
  rows: T[];
  columns: DataColumn<T>[];
  stickyFirst?: boolean;
  onRowHover?: (row: T | null) => void;
  onRowActivate?: (row: T) => void;
  selectedRowId?: string;
}) {
  return (
    <div className="sys-data-table" data-sticky-first={stickyFirst}>
      <Table<T>
        data={rows}
        idKey="id"
        density="compact"
        hasHover
        dividers="rows"
        columns={columns.map((c, i) => ({
          key: c.key,
          width: proportional(c.minWidth ?? (i === 0 ? 160 : 100), { minWidth: c.minWidth ?? (i === 0 ? 130 : 80) }),
          header: c.sortable ? (
            <button type="button" className="sys-sort" onClick={c.onSort}>
              {c.header} ↕
            </button>
          ) : (
            c.header
          ),
          align: c.numeric ? 'end' : 'start',
          renderCell: (row: T) => (
            <span
              className="sys-table-cell"
              data-kind={row.kind ?? 'row'}
              data-first={i === 0}
              data-selected={row.id === selectedRowId || undefined}
              onClick={onRowActivate ? () => onRowActivate(row) : undefined}
              onMouseEnter={() => onRowHover?.(row)}
              onMouseLeave={() => onRowHover?.(null)}
              onFocus={() => onRowHover?.(row)}
              onBlur={() => onRowHover?.(null)}
            >
              {c.render(row)}
            </span>
          ),
        }))}
      />
    </div>
  );
}
