import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import "./sortable.css";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Column sorting for a table. `columns` maps a sort key to how to read it:
 *   { [key]: { value: (row) => any, numeric?: boolean } }
 * Numeric columns sort largest first on the first click, text columns A to Z.
 * Empty values (null/undefined) always go last.
 */
export function useSort(rows, columns, initial) {
    const [sort, setSort] = useState(initial);

    const sorted = useMemo(() => {
        const col = sort && columns[sort.key];
        if (!col) return rows;
        const dir = sort.dir === "asc" ? 1 : -1;
        return [...rows].sort((a, b) => {
            const va = col.value(a);
            const vb = col.value(b);
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            return dir * (col.numeric ? va - vb : collator.compare(String(va), String(vb)));
        });
        // columns is a static description per table
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, sort]);

    const toggle = (key) => setSort((s) => {
        if (s?.key === key) return { key, dir: s.dir === "asc" ? "desc" : "asc" };
        return { key, dir: columns[key]?.numeric ? "desc" : "asc" };
    });

    return { sorted, sort, toggle };
}

/** Header cell that sorts its column; numeric columns stay right-aligned over their figures. */
export function SortTh({ label, sortKey, sort, onSort, numeric = false, style }) {
    const active = sort?.key === sortKey;
    const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
        <th className={numeric ? "ds-num" : undefined} style={style} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
            <button type="button" className={`ds-sort${active ? " is-active" : ""}${numeric ? " is-numeric" : ""}`} onClick={() => onSort(sortKey)}>
                <span>{label}</span>
                <Icon size={13} />
            </button>
        </th>
    );
}
