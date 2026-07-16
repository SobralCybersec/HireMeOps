import type { ReactNode } from "react";

export interface Column<T> {
  /** Stable key; also used as React key for the column. */
  key: string;
  header: ReactNode;
  /** Cell renderer. Falls back to `String(row[key])` when omitted. */
  render?: (row: T) => ReactNode;
  /** Mono/tabular treatment (numbers, ids, timestamps). */
  mono?: boolean;
  /** Emphasised primary column (brighter text). */
  primary?: boolean;
  align?: "left" | "right" | "center";
  width?: number | string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Shown in place of the table body when there are no rows. */
  empty?: ReactNode;
  className?: string;
}

/** Dense data grid. Wraps `.table-wrapper` + `.data-table` from theme.css. */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  empty,
  className,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty != null) {
    return <>{empty}</>;
  }

  const cellClass = (col: Column<T>) =>
    [col.mono ? "cell-mono" : null, col.primary ? "cell-primary" : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={["table-wrapper", className].filter(Boolean).join(" ")}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={{ textAlign: col.align, width: col.width }} scope="col">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={getRowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={onRowClick ? { cursor: "pointer" } : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} className={cellClass(col)} style={{ textAlign: col.align }}>
                  {col.render
                    ? col.render(row)
                    : String((row as Record<string, unknown>)[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
