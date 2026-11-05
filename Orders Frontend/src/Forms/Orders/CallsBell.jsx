import React, { useEffect, useRef, useState } from "react";
import { Bell, BellRing, Check, ClipboardList, PhoneIncoming, PhoneMissed, PhoneCall, Plus, Search, X } from "lucide-react";
import { getCalls } from "./ordersApi";
import DateRange, { describeDateRange } from "./DateRange";
import { formatDay } from "../../utils/dates";

const STATUS = {
    Ringing: { label: "Ringing", tone: "info", icon: PhoneIncoming },
    Missed: { label: "Missed", tone: "danger", icon: PhoneMissed },
    Answered: { label: "No order yet", tone: "warning", icon: PhoneCall },
    Handled: { label: "Handled", tone: "muted", icon: Check },
    Ordered: { label: "Ordered", tone: "success", icon: ClipboardList },
};

const RANGES = [
    { key: "today", label: "Today" },
    { key: "earlier", label: "Earlier" },
];

const SEARCH_TAKE = 200;

const pad = (n) => String(n).padStart(2, "0");
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const isToday = (c) => new Date(c.receivedAt).getTime() >= startOfToday();
const timeOf = (d) => `${pad(d.getHours() % 12 || 12)}:${pad(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;

function dayLabel(value) {
    const d = new Date(value);
    if (d.getTime() >= startOfToday()) return "Today";
    if (d.getTime() >= startOfToday() - 86400000) return "Yesterday";
    return formatDay(d);
}

// Today: "5 min ago" / time; older calls sit under their day's heading, so the time is enough.
function when(value) {
    const d = new Date(value);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins} min ago`;
    return timeOf(d);
}

const callerOf = (c) => c.clientName?.trim()
    || (c.match === "Multiple" ? `${c.matchCount} clients share this number` : "Unknown caller");

// Ringing (also when ignored here), missed, or answered without an order.
const needsSomeone = (c) => c.status === "Ringing" || c.status === "Missed" || c.status === "Answered";

// [{ day, calls }] in the list's order (newest first)
function byDay(calls) {
    const groups = [];
    calls.forEach((c) => {
        const day = dayLabel(c.receivedAt);
        if (groups[groups.length - 1]?.day !== day) groups.push({ day, calls: [] });
        groups[groups.length - 1].calls.push(c);
    });
    return groups;
}

/**
 * Today's calls that still need someone. `activeCallId` is the call open in the order modal
 * right now - it is being dealt with.
 */
export function callsNeedingAttention(history, activeCallId) {
    return history.filter((c) => needsSomeone(c) && isToday(c) && String(c.recID) !== String(activeCallId ?? ""));
}

/*
 * Bell in the top bar. Green and shaking while a call rings (ignored ones too); the red badge
 * counts today's calls that need someone. The panel shows Today, or Earlier (every day before
 * today, by day) - the calls needing someone first, then the rest. The search box looks through
 * the whole call history for a number or a client name.
 */
export default function CallsBell({ history, ringing, activeCallId, onOpen, onTakeRinging, onTakeOrder, onOpenOrder, onHandled }) {
    const [open, setOpen] = useState(false);
    const [range, setRange] = useState("today");
    const [query, setQuery] = useState("");
    const [dates, setDates] = useState({ from: "", to: "" });
    const [results, setResults] = useState(null); // search results, null while not searching
    const [searching, setSearching] = useState(false);
    const ref = useRef(null);

    const badge = callsNeedingAttention(history, activeCallId).length;
    const isActive = (c) => String(c.recID) === String(activeCallId ?? "");
    const q = query.trim();
    // searching or a date range: ask the server (whole history) instead of using the latest calls
    const filtering = !!(q || dates.from || dates.to);

    useEffect(() => {
        if (!open) return undefined;
        const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("mousedown", onDoc);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDoc);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    // Search the server (whole history), a moment after typing stops; again when the history
    // changes, so a call marked handled shows its new state in the results too.
    useEffect(() => {
        if (!open || !filtering) { setResults(null); setSearching(false); return undefined; }
        let cancelled = false;
        setSearching(true);
        const timer = window.setTimeout(async () => {
            try {
                const found = await getCalls(SEARCH_TAKE, { search: q, from: dates.from, to: dates.to });
                if (!cancelled) setResults(found);
            } catch {
                if (!cancelled) setResults([]);
            } finally {
                if (!cancelled) setSearching(false);
            }
        }, 300);
        return () => { cancelled = true; window.clearTimeout(timer); };
    }, [open, filtering, q, dates.from, dates.to, history]);

    const toggle = () => {
        if (!open) onOpen?.();
        setOpen((o) => !o);
    };
    // closes the panel, then runs the action for that call
    const act = (fn, call) => () => { setOpen(false); fn(call); };

    const actionsFor = (c) => {
        if (isActive(c)) return <span className="ord-bell-open">Open now</span>;
        if (c.status === "Ringing") {
            return (
                <button type="button" className="ds-btn ord-btn-sm ord-bell-answer" onClick={act(onTakeRinging, c)} title="Take this caller's order">
                    <Plus size={14} /> Take order
                </button>
            );
        }
        if (c.status === "Missed" || c.status === "Answered") {
            return (
                <>
                    {/* stays open: several calls are often marked in a row */}
                    <button type="button" className="ds-btn ds-btn-icon" onClick={() => onHandled(c)} title="Mark handled - no order needed">
                        <Check size={14} />
                    </button>
                    <button type="button" className="ds-btn ds-btn-primary ord-btn-sm" onClick={act(onTakeOrder, c)}>
                        <Plus size={14} /> Take order
                    </button>
                </>
            );
        }
        if (c.orderID != null) {
            return (
                <button type="button" className="ds-btn ds-btn-secondary ord-btn-sm" onClick={act(onOpenOrder, c.orderID)} title="Open this order">
                    <ClipboardList size={14} /> #{c.orderID}
                </button>
            );
        }
        return (
            <button type="button" className="ds-btn ds-btn-secondary ord-btn-sm" onClick={act(onTakeOrder, c)} title="Take an order for this caller">
                <Plus size={14} /> Order
            </button>
        );
    };

    const rows = (list) => list.map((c) => <CallRow key={c.recID} call={c}>{actionsFor(c)}</CallRow>);
    const dayGroups = (list) => byDay(list).map((g) => (
        <React.Fragment key={g.day}>
            <div className="ord-bell-section">{g.day}</div>
            {rows(g.calls)}
        </React.Fragment>
    ));

    let content;
    if (filtering) {
        const what = [q && `from "${q}"`, describeDateRange(dates)].filter(Boolean).join(" ");
        content = searching && results == null ? <div className="ord-bell-empty">Searching...</div>
            : !results?.length ? <div className="ord-bell-empty">No calls {what}.</div>
            : dayGroups(results);
    } else {
        const inRange = history.filter((c) => (range === "today" ? isToday(c) : !isToday(c)));
        const attention = inRange.filter((c) => needsSomeone(c) && !isActive(c));
        const others = inRange.filter((c) => !needsSomeone(c) || isActive(c));
        content = (
            <>
                {attention.length > 0 && (
                    <>
                        <div className="ord-bell-section">Needs attention · {attention.length}</div>
                        {rows(attention)}
                    </>
                )}
                {range === "today" ? (
                    <>
                        <div className="ord-bell-section">Today's calls</div>
                        {others.length ? rows(others) : <div className="ord-bell-empty">{attention.length ? "No other calls." : "No calls today."}</div>}
                    </>
                ) : others.length ? dayGroups(others) : !attention.length && <div className="ord-bell-empty">No earlier calls.</div>}
            </>
        );
    }

    return (
        <div className="ds-menu-anchor" ref={ref}>
            <button
                type="button"
                className={`ds-btn ds-btn-icon ord-bell${badge ? " has-alerts" : ""}${ringing ? " is-ringing" : ""}`}
                onClick={toggle}
                aria-expanded={open}
                aria-label={ringing ? "Calls - a call is ringing" : badge ? `Calls - ${badge} need attention` : "Calls"}
                title="Calls and call history"
            >
                {ringing ? <BellRing size={18} /> : <Bell size={18} />}
                {badge > 0 && <span className="ord-bell-badge">{badge > 99 ? "99+" : badge}</span>}
            </button>

            {open && (
                <div className="ord-bell-panel" role="dialog" aria-label="Calls">
                    <div className="ord-bell-head">
                        <strong>Calls</strong>
                        {!filtering && (
                            <div className="ds-segmented ord-seg-sm" role="tablist" aria-label="Which calls">
                                {RANGES.map((r) => (
                                    <button key={r.key} type="button" role="tab" aria-selected={range === r.key} className={range === r.key ? "is-active" : ""} onClick={() => setRange(r.key)}>
                                        {r.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="ord-bell-search ord-search">
                        <Search size={15} className="ord-search-icon" />
                        <input
                            className="ds-field ds-field-sm"
                            placeholder="Search a number or client..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            aria-label="Search calls by number or client"
                        />
                        {query && (
                            <button type="button" className="ord-bell-clear" onClick={() => setQuery("")} aria-label="Clear search">
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <DateRange value={dates} onChange={setDates} compact />
                    <div className="ord-bell-scroll">{content}</div>
                </div>
            )}
        </div>
    );
}

function CallRow({ call, children }) {
    const s = STATUS[call.status] ?? STATUS.Handled;
    const Icon = s.icon;
    return (
        <div className={`ord-bell-row is-${s.tone}`}>
            <span className="ord-bell-icon"><Icon size={15} /></span>
            <div className="ord-bell-info">
                <span className="ord-bell-who">{callerOf(call)}</span>
                <span className="ord-bell-meta">
                    <span className="ord-num">{call.phone}</span>
                    <span>·</span>
                    <span>{when(call.receivedAt)}</span>
                    <span className="ord-bell-status">{s.label}</span>
                </span>
            </div>
            <div className="ord-bell-actions">{children}</div>
        </div>
    );
}
