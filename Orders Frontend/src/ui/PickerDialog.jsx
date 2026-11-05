import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Search, X } from "lucide-react";
import Dialog from "./Dialog";
import Pagination from "./Pagination";
import { apiErrorMessage } from "../Forms/Orders/ordersApi";
import { useToaster } from "./toast/Toaster";
import "./picker.css";

const SEARCH_DEBOUNCE_MS = 350;

/*
 * Searchable, server-paged lookup over large tables (clients, stock items, product groups).
 *
 * sources: [{ id, label, fetchPage({ page, pageSize, search }) → { items, total },
 *             fetchAll({ search }) → items (optional, enables "Select all" across pages),
 *             columns: [{ key, label, render?, width?, className? }], searchPlaceholder }]
 * multi:   checkbox selection kept across pages, searches and sources.
 * disabledKeys: rows already chosen elsewhere (shown as "Added").
 */
export default function PickerDialog({
    title,
    subtitle,
    icon,
    sources,
    rowKey,
    multi = false,
    disabledKeys,
    confirmLabel = "Add",
    onConfirm,
    onClose,
}) {
    const [sourceId, setSourceId] = useState(sources[0].id);
    const source = sources.find((s) => s.id === sourceId) ?? sources[0];

    const [search, setSearch] = useState("");
    const [debounced, setDebounced] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [state, setState] = useState({ status: "loading", items: [], total: 0, error: null });
    const [selected, setSelected] = useState(() => new Map());
    const [selectingAll, setSelectingAll] = useState(false);
    const requestId = useRef(0);
    const searchRef = useRef(null);
    const toast = useToaster();

    useEffect(() => {
        const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [search]);

    // Latest source without refetching when the parent re-renders with new objects.
    const sourceRef = useRef(source);
    sourceRef.current = source;

    useEffect(() => {
        const id = ++requestId.current;
        setState((s) => ({ ...s, status: "loading", error: null }));
        sourceRef.current.fetchPage({ page, pageSize, search: debounced })
            .then(({ items, total }) => {
                if (id === requestId.current) setState({ status: "ready", items, total, error: null });
            })
            .catch((err) => {
                if (id === requestId.current) setState({ status: "error", items: [], total: 0, error: apiErrorMessage(err) });
            });
    }, [sourceId, page, pageSize, debounced]);

    const switchSource = (id) => {
        setSourceId(id);
        setPage(1);
    };

    const toggle = (row) => {
        const key = rowKey(row);
        if (!multi) {
            onConfirm([row]);
            return;
        }
        setSelected((prev) => {
            const next = new Map(prev);
            if (next.has(key)) next.delete(key);
            else next.set(key, row);
            return next;
        });
    };

    const selectableOnPage = useMemo(
        () => state.items.filter((r) => !disabledKeys?.has(rowKey(r))),
        [state.items, disabledKeys, rowKey]
    );
    const allOnPageSelected = selectableOnPage.length > 0 && selectableOnPage.every((r) => selected.has(rowKey(r)));

    const togglePage = () => {
        setSelected((prev) => {
            const next = new Map(prev);
            selectableOnPage.forEach((r) => {
                if (allOnPageSelected) next.delete(rowKey(r));
                else next.set(rowKey(r), r);
            });
            return next;
        });
    };

    // Every row matching the current search, across all pages.
    const selectAll = async () => {
        if (!source.fetchAll) return;
        setSelectingAll(true);
        try {
            const rows = await source.fetchAll({ search: debounced });
            setSelected((prev) => {
                const next = new Map(prev);
                rows.forEach((r) => { if (!disabledKeys?.has(rowKey(r))) next.set(rowKey(r), r); });
                return next;
            });
        } catch (err) {
            toast.error(apiErrorMessage(err, "Couldn't select all rows."));
        } finally {
            setSelectingAll(false);
        }
    };

    const footer = multi ? (
        <>
            <span className="pk-selected">
                {selected.size > 0 ? (
                    <>
                        <strong>{selected.size.toLocaleString()}</strong> selected
                        <button type="button" className="ds-btn ds-btn-ghost pk-btn-sm" onClick={() => setSelected(new Map())}>
                            <X size={14} />
                            Clear
                        </button>
                    </>
                ) : "Select one or more rows"}
            </span>
            <button type="button" className="ds-btn ds-btn-secondary" onClick={onClose}>Cancel</button>
            <button
                type="button"
                className="ds-btn ds-btn-primary"
                disabled={selected.size === 0}
                onClick={() => onConfirm([...selected.values()])}
            >
                <Check size={16} />
                {confirmLabel}{selected.size > 0 ? ` ${selected.size.toLocaleString()}` : ""}
            </button>
        </>
    ) : (
        <button type="button" className="ds-btn ds-btn-secondary" onClick={onClose}>Cancel</button>
    );

    return (
        <Dialog
            title={title}
            subtitle={subtitle}
            icon={icon}
            size="lg"
            onClose={onClose}
            initialFocusRef={searchRef}
            bodyClassName="pk-body"
            footer={footer}
        >
            <div className="pk-toolbar">
                <div className="pk-search">
                    <Search size={16} className="pk-search-icon" />
                    <input
                        ref={searchRef}
                        type="search"
                        className="ds-field"
                        placeholder={source.searchPlaceholder ?? "Search…"}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                        <button type="button" className="pk-search-clear" onClick={() => setSearch("")} aria-label="Clear search">
                            <X size={14} />
                        </button>
                    )}
                </div>
                {sources.length > 1 && (
                    <div className="ds-segmented" role="tablist">
                        {sources.map((s) => (
                            <button
                                key={s.id}
                                type="button"
                                role="tab"
                                aria-selected={s.id === sourceId}
                                className={s.id === sourceId ? "is-active" : ""}
                                onClick={() => switchSource(s.id)}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {multi && (
                <div className="pk-select-bar">
                    <span className="pk-select-info">
                        {state.total.toLocaleString()} {state.total === 1 ? "record" : "records"}{debounced ? ` matching "${debounced}"` : ""}
                    </span>
                    {source.fetchAll && (
                        <button
                            type="button"
                            className="ds-btn ds-btn-secondary pk-btn-sm"
                            onClick={selectAll}
                            disabled={selectingAll || state.total === 0}
                        >
                            <CheckCheck size={15} />
                            {selectingAll ? "Selecting…" : `Select all ${state.total.toLocaleString()}`}
                        </button>
                    )}
                    <button
                        type="button"
                        className="ds-btn ds-btn-secondary pk-btn-sm"
                        onClick={() => setSelected(new Map())}
                        disabled={selected.size === 0}
                    >
                        <X size={15} />
                        Unselect all
                    </button>
                </div>
            )}

            <div className={`pk-table-wrap${state.status === "loading" ? " is-loading" : ""}`}>
                <table className="pk-table">
                    <thead>
                        <tr>
                            {multi && (
                                <th className="pk-check">
                                    <input
                                        type="checkbox"
                                        className="ds-checkbox"
                                        checked={allOnPageSelected}
                                        onChange={togglePage}
                                        disabled={selectableOnPage.length === 0}
                                        aria-label="Select all on this page"
                                    />
                                </th>
                            )}
                            {source.columns.map((c) => (
                                <th key={c.key} style={c.width ? { width: c.width } : undefined}>{c.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {state.items.map((row) => {
                            const key = rowKey(row);
                            const added = disabledKeys?.has(key);
                            const isSelected = selected.has(key);
                            return (
                                <tr
                                    key={key}
                                    className={`${isSelected ? "is-selected" : ""}${added ? " is-added" : ""}`}
                                    onClick={() => !added && toggle(row)}
                                >
                                    {multi && (
                                        <td className="pk-check">
                                            {added
                                                ? <span className="ds-badge is-inactive">Added</span>
                                                : (
                                                    <input
                                                        type="checkbox"
                                                        className="ds-checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggle(row)}
                                                        onClick={(e) => e.stopPropagation()}
                                                        aria-label="Select row"
                                                    />
                                                )}
                                        </td>
                                    )}
                                    {source.columns.map((c) => (
                                        <td key={c.key} className={c.className}>
                                            {c.render ? c.render(row) : (row[c.key] || "")}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>

                {state.status === "ready" && state.items.length === 0 && (
                    <div className="pk-message">{debounced ? `Nothing matches "${debounced}".` : "No records."}</div>
                )}
                {state.status === "error" && <div className="pk-message is-error">{state.error}</div>}
                {state.status === "loading" && state.items.length === 0 && <div className="pk-message">Loading…</div>}
            </div>

            <Pagination
                page={page}
                pageSize={pageSize}
                total={state.total}
                onPageChange={setPage}
                onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
                pageSizes={[25, 50, 100]}
            />
        </Dialog>
    );
}
