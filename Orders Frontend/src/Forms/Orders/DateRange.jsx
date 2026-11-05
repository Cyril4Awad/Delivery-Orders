import React from "react";
import { CalendarDays, X } from "lucide-react";
import { formatDay } from "../../utils/dates";

const pad = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of a date in local time - the format date inputs use, so ranges compare as text. */
export const dayKey = (value) => {
    const d = new Date(value);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Is the date inside { from, to } ("YYYY-MM-DD", either may be empty)? Both ends included. */
export const inDateRange = (value, { from, to }) => {
    if (!from && !to) return true;
    const k = dayKey(value);
    return (!from || k >= from) && (!to || k <= to);
};

/** "from Thursday 01/10/2026 to Friday 23/10/2026", "from ...", "until ..." or "" - for report headers. */
export const describeDateRange = ({ from, to }) => {
    const show = formatDay;
    if (from && to) return from === to ? `on ${show(from)}` : `from ${show(from)} to ${show(to)}`;
    if (from) return `from ${show(from)}`;
    if (to) return `until ${show(to)}`;
    return "";
};

/*
 * From / To date filter. value = { from, to } as "YYYY-MM-DD" strings ("" = open end).
 * Each end limits the other, so the range can't be reversed; "x" clears both.
 */
export default function DateRange({ value, onChange, compact = false }) {
    const { from, to } = value;
    const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });
    return (
        <div className={`ord-daterange${compact ? " is-compact" : ""}${from || to ? " is-set" : ""}`} role="group" aria-label="Date range">
            <CalendarDays size={compact ? 14 : 16} className="ord-daterange-icon" aria-hidden="true" />
            <label>
                <span>From</span>
                <input type="date" value={from} max={to || undefined} onChange={set("from")} aria-label="From date" />
            </label>
            <label>
                <span>To</span>
                <input type="date" value={to} min={from || undefined} onChange={set("to")} aria-label="To date" />
            </label>
            {(from || to) && (
                <button type="button" className="ord-daterange-clear" onClick={() => onChange({ from: "", to: "" })} aria-label="Clear dates" title="Clear dates">
                    <X size={14} />
                </button>
            )}
        </div>
    );
}
