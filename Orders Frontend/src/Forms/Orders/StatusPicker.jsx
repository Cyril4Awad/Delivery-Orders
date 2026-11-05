import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, PenLine } from "lucide-react";
import { BUILT_IN_STATUSES, useStatuses } from "./statusList";

// The statuses offered come from tbl_OrderStatus (statusList.js); any other text typed in is kept
// as the order's status (up to 50 characters) and offered from then on.
export const DEFAULT_STATUS = BUILT_IN_STATUSES[0];
const MAX_LENGTH = 50;

const findIn = (list, s) => list.find((k) => k.toLowerCase() === String(s ?? "").trim().toLowerCase());

export const isCompleted = (status) => findIn(BUILT_IN_STATUSES, status) === "Completed";

/** Colour of a status: process (amber), ready (blue), delivery (violet), done (green), any other one (grey). */
export function statusTone(status) {
    switch (findIn(BUILT_IN_STATUSES, status)) {
        case "Under process": return "process";
        case "Ready": return "ready";
        case "Ready to be delivered": return "delivery";
        case "Completed": return "done";
        default: return "custom";
    }
}

// A typed status, cleaned up: spaces collapsed, the listed ones in their own spelling.
const cleanIn = (list, s) => {
    const t = String(s ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
    return findIn(list, t) ?? t;
};

/*
 * Order status: a pill that opens a list of the listed statuses, with a box on top to type any
 * other status. Arrows move through the list, Enter picks (the typed text when nothing is
 * highlighted), Escape closes. The list is portalled and placed under the pill (above it when
 * there is no room), so a table or dialog that scrolls doesn't cut it.
 *
 * variant: "pill" (orders table) | "field" (order modal, full width)
 */
export default function StatusPicker({ value, onChange, variant = "pill", id, disabled = false }) {
    const [open, setOpen] = useState(false);
    const [typed, setTyped] = useState("");
    const [active, setActive] = useState(-1); // highlighted row; -1 = none (Enter uses the typed text)
    const [pos, setPos] = useState(null);
    const anchorRef = useRef(null);
    const popRef = useRef(null);
    const inputRef = useRef(null);
    const statuses = useStatuses();
    const known = (s) => findIn(statuses, s);
    const clean = (s) => cleanIn(statuses, s);

    const current = value || DEFAULT_STATUS;
    const typedClean = clean(typed);
    const typedIsNew = !!typedClean && !known(typedClean);
    // the statuses matching what's typed come first, then "Use '...'" for a new one
    const q = typedClean.toLowerCase();
    const options = q
        ? [...statuses.filter((s) => s.toLowerCase().includes(q)), ...statuses.filter((s) => !s.toLowerCase().includes(q))]
        : statuses;
    const rows = typedIsNew ? [...options, { custom: typedClean }] : options;

    const close = (refocus = true) => {
        setOpen(false);
        setPos(null);
        if (refocus) anchorRef.current?.focus({ preventScroll: true });
    };

    const pick = (status) => {
        const next = clean(status);
        close();
        if (next && next !== current) onChange(next);
    };

    const openList = () => {
        if (disabled) return;
        setTyped("");
        setActive(statuses.indexOf(known(current) ?? ""));
        setOpen(true);
    };

    useLayoutEffect(() => {
        if (!open) return undefined;
        const place = () => {
            const r = anchorRef.current?.getBoundingClientRect();
            if (!r) return;
            const width = Math.max(r.width, 250);
            const height = popRef.current?.offsetHeight ?? 220;
            const roomBelow = window.innerHeight - r.bottom;
            const top = roomBelow < height + 12 && r.top > height + 12 ? r.top - height - 6 : r.bottom + 6;
            const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
            setPos({ top, left, width });
        };
        place();
        inputRef.current?.focus({ preventScroll: true });
        window.addEventListener("resize", place);
        return () => window.removeEventListener("resize", place);
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => {
            if (!popRef.current?.contains(e.target) && !anchorRef.current?.contains(e.target)) close(false);
        };
        // the page or dialog scrolled under the list: close it rather than leave it floating
        const onScroll = (e) => { if (!popRef.current?.contains(e.target)) close(false); };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("scroll", onScroll, true);
        };
    }, [open]);

    const onKeyDown = (e) => {
        // the list's keys stay here: Escape must not also close the order dialog under it
        if (["Escape", "Enter", "ArrowDown", "ArrowUp"].includes(e.key)) e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); close(); }
        else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % rows.length); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? rows.length - 1 : a - 1)); }
        else if (e.key === "Enter") {
            e.preventDefault();
            const row = rows[active];
            if (row) pick(typeof row === "string" ? row : row.custom);
            else if (typedClean) pick(typedClean);
        } else if (e.key === "Tab") close(false);
    };

    return (
        <>
            <button
                ref={anchorRef}
                id={id}
                type="button"
                className={`ord-status is-${statusTone(current)}${variant === "field" ? " is-field" : ""}`}
                aria-haspopup="listbox"
                aria-expanded={open}
                disabled={disabled}
                onClick={() => (open ? close() : openList())}
                onDoubleClick={(e) => e.stopPropagation()}
                title="Change the status"
            >
                <span className="ord-status-text">{current}</span>
                <ChevronDown size={variant === "field" ? 16 : 13} className="ord-status-chevron" />
            </button>
            {open && createPortal(
                <div
                    ref={popRef}
                    className="ord-status-pop"
                    style={pos ? { top: pos.top, left: pos.left, width: pos.width } : { visibility: "hidden" }}
                    onKeyDown={onKeyDown}
                    // React events bubble through the portal: a double click here must not open the table row
                    onDoubleClick={(e) => e.stopPropagation()}
                >
                    <div className="ord-status-type">
                        <PenLine size={14} />
                        <input
                            ref={inputRef}
                            className="ord-status-input"
                            placeholder="Type a status..."
                            value={typed}
                            maxLength={MAX_LENGTH}
                            onChange={(e) => { setTyped(e.target.value); setActive(e.target.value.trim() ? 0 : -1); }}
                            aria-label="Type a status"
                        />
                    </div>
                    <div className="ord-status-list" role="listbox" aria-label="Status">
                        {rows.map((row, i) => {
                            const isCustom = typeof row !== "string";
                            const label = isCustom ? row.custom : row;
                            const selected = !isCustom && known(current) === row;
                            return (
                                <button
                                    type="button"
                                    key={isCustom ? "__custom" : row}
                                    role="option"
                                    aria-selected={selected}
                                    className={`ord-status-option${i === active ? " is-active" : ""}`}
                                    onMouseEnter={() => setActive(i)}
                                    onClick={() => pick(label)}
                                >
                                    {isCustom
                                        ? <PenLine size={13} className="ord-status-dot-icon" />
                                        : <span className={`ord-status-dot is-${statusTone(row)}`} />}
                                    <span className="ord-status-option-text">
                                        {isCustom ? <>Use "<strong>{label}</strong>"</> : row}
                                    </span>
                                    {selected && <Check size={14} className="ord-status-check" />}
                                </button>
                            );
                        })}
                    </div>
                    {!known(current) && <div className="ord-status-now">Now: <strong>{current}</strong></div>}
                </div>,
                document.body
            )}
        </>
    );
}
