import { useState, type ReactNode } from 'react';

const SIZES = [10, 25, 50, 100];

export type Paging = { page: number; pages: number; size: number; total: number; setPage: (p: number) => void; setSize: (n: number) => void };

/**
 * Splits `rows` into pages. The page stays in range when the list shrinks (delete), and goes back
 * to page 1 when `resetKey` changes (pass the search text / filter).
 */
export function usePaged<T>(rows: T[], resetKey: unknown = null, initialSize = 10): { shown: T[]; paging: Paging } {
  const [size, setSizeRaw] = useState(initialSize);
  const [page, setPage] = useState(0);
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    setKey(resetKey);
    setPage(0);
  }
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const cur = Math.min(page, pages - 1);
  return {
    shown: rows.slice(cur * size, cur * size + size),
    paging: {
      page: cur,
      pages,
      size,
      total: rows.length,
      setPage,
      setSize: (n) => {
        setSizeRaw(n);
        setPage(0);
      },
    },
  };
}

/** Page numbers with gaps: 1 … 4 5 6 … 12 */
function pageList(page: number, pages: number): (number | 'gap')[] {
  const want = new Set([0, pages - 1, page - 1, page, page + 1]);
  const out: (number | 'gap')[] = [];
  for (let i = 0; i < pages; i++) {
    if (want.has(i)) out.push(i);
    else if (out[out.length - 1] !== 'gap') out.push('gap');
  }
  return out;
}

/** Table footer: "Showing 11–20 of 57 users", rows-per-page, and page buttons. */
export function Pager({ paging, noun = 'rows', extra }: { paging: Paging; noun?: string; extra?: ReactNode }) {
  const { page, pages, size, total, setPage, setSize } = paging;
  const from = total ? page * size + 1 : 0;
  const to = Math.min(total, page * size + size);
  return (
    <div className="table-foot">
      <div className="pager-info">
        <span>
          Showing <b>{from.toLocaleString()}</b>–<b>{to.toLocaleString()}</b> of <b>{total.toLocaleString()}</b> {noun}
        </span>
        {total > SIZES[0] ? (
          <label className="pager-size">
            Rows per page
            <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {extra}
      </div>
      {pages > 1 ? (
        <nav className="pager" aria-label="Pagination">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">
            ‹ Prev
          </button>
          {pageList(page, pages).map((p, i) =>
            p === 'gap' ? (
              <span key={`g${i}`} className="gap">
                …
              </span>
            ) : (
              <button
                type="button"
                key={p}
                className={`pnum ${p === page ? 'on' : ''}`}
                aria-current={p === page ? 'page' : undefined}
                disabled={p === page}
                onClick={() => setPage(p)}>
                {p + 1}
              </button>
            ),
          )}
          <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page">
            Next ›
          </button>
        </nav>
      ) : null}
    </div>
  );
}
