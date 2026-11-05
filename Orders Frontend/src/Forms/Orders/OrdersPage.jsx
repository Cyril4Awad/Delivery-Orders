import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ClipboardList, Download, FileSpreadsheet, MapPin, Moon, Pencil, Plus, Printer, Search, Sun, Volume2, VolumeX } from "lucide-react";
import "../../ui/ui.css";
import "./orders.css";
import { useTheme } from "../../theme/useTheme";
import { useToaster } from "../../ui/toast/Toaster";
import { SortTh, useSort } from "../../ui/sortable";
import Pagination from "../../ui/Pagination";
import ConfirmDialog from "../../ui/ConfirmDialog";
import { apiErrorMessage, getCall, getCalls, getOrders, markCallHandled, setOrderStatus } from "./ordersApi";
import { useOrdersHub } from "./useOrdersHub";
import { useRingtone } from "./useRingtone";
import CallPopup, { callerName } from "./CallPopup";
import CallsBell from "./CallsBell";
import DateRange, { describeDateRange, inDateRange } from "./DateRange";
import OrderModal from "./OrderModal";
import StatusPicker, { isCompleted, statusTone } from "./StatusPicker";
import { refreshStatuses } from "./statusList";
import { exportOrdersToExcel, printOrder, printOrdersReport } from "./orderReports";
import { htmlToText } from "./richText";
import { loadCompanyInfo } from "../../utils/appSettings";
import { formatDateTime } from "../../utils/dates";

// by status tone (see StatusPicker): "custom" = a status typed in, shown only when there are some
const FILTERS = [
    { key: "all", label: "All" },
    { key: "process", label: "Under process" },
    { key: "ready", label: "Ready" },
    { key: "delivery", label: "To be delivered" },
    { key: "done", label: "Completed" },
    { key: "custom", label: "Other" },
];

const phoneOf = (o) => o.phone || o.clientPhone1 || o.clientPhone2 || null;
const addressOf = (o) => o.address?.trim() || o.clientAddress?.trim() || null;
// Lines of the order's plain text, shown one after the other on a single table line.
const orderLines = (text) => (text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const blankToNull = (v) => (v && String(v).trim() ? String(v).trim() : null);

// How each sortable column reads its value (see ui/sortable.jsx).
const SORT_COLUMNS = {
    recID: { value: (o) => Number(o.recID), numeric: true },
    client: { value: (o) => blankToNull(o.clientName) },
    phone: { value: (o) => blankToNull(phoneOf(o)) },
    orderText: { value: (o) => blankToNull(o.orderPlain) },
    created: { value: (o) => (o.cdStamp ? new Date(o.cdStamp).getTime() : null), numeric: true },
    status: { value: (o) => blankToNull(o.status) },
};

const PAGE_SIZE_KEY = "ord-orders-page-size";
const readPageSize = () => {
    try { return Number(localStorage.getItem(PAGE_SIZE_KEY)) || 25; } catch { return 25; }
};

// A call picked up on the phone stays in the popup this long for its order to be taken (then: the bell).
const ANSWERED_KEEP_MS = 10 * 60 * 1000;


export default function OrdersPage() {
    const { isDark, toggleTheme } = useTheme();
    const toast = useToaster();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [filter, setFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [dates, setDates] = useState({ from: "", to: "" }); // created between, "YYYY-MM-DD"
    const [modal, setModal] = useState(null); // null | { order } | { call } | {}
    const [calls, setCalls] = useState([]); // ringing here, oldest first
    const [callLog, setCallLog] = useState([]); // call history for the bell
    const [pendingSwitch, setPendingSwitch] = useState(null); // { next, heldCall? } waiting on "discard the open order?"
    const modalDirty = useRef(false);
    const [muted, setMuted] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(readPageSize);
    const [exportOpen, setExportOpen] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [companyName, setCompanyName] = useState("");
    const exportRef = useRef(null);

    const load = useCallback(async () => {
        try {
            // the order text is HTML: its plain text, once, for the table, search and sorting
            setOrders((await getOrders()).map((o) => ({ ...o, orderPlain: htmlToText(o.orderText) })));
            setLoadFailed(false);
            // a save here or on another screen may have added a status to the list
            refreshStatuses();
        } catch (e) {
            setLoadFailed(true);
            toast.error(apiErrorMessage(e, "The orders couldn't be loaded. Try again."));
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { load(); }, [load]);

    const loadCalls = useCallback(async () => {
        try {
            setCallLog(await getCalls(300));
        } catch {
            // the bell keeps its last list; orders loading reports connection problems
        }
    }, []);

    // Ringing calls turn into missed calls with time, so the history also refreshes on its own.
    useEffect(() => {
        loadCalls();
        const timer = window.setInterval(loadCalls, 60000);
        return () => window.clearInterval(timer);
    }, [loadCalls]);

    // report headers need the company name; read it up front so printing opens straight away
    // also the client's name under the brand (com_company)
    useEffect(() => { loadCompanyInfo().then((info) => setCompanyName(info.name)); }, []);

    useEffect(() => {
        if (!exportOpen) return undefined;
        const onDoc = (e) => { if (!exportRef.current?.contains(e.target)) setExportOpen(false); };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [exportOpen]);

    const { connected, takeCall } = useOrdersHub({
        onIncomingCall: (call) => {
            // ringsUntil: when it leaves the popup - after its ring time, or a while later when it came in
            // already picked up on the phone (ONGOING without INCOMING)
            const ringsUntil = Date.now() + (call.answered ? ANSWERED_KEEP_MS : (call.ringSeconds || 45) * 1000);
            setCalls((list) => [...list.filter((c) => c.phone !== call.phone), { ...call, ringsUntil }]);
            loadCalls();
        },
        // picked up on the phone: stop ringing, keep it in the popup so its order can be taken
        onCallAnswered: (callId) => {
            setCalls((list) => list.map((c) => (String(c.callId) === String(callId)
                ? { ...c, answered: true, ringsUntil: Date.now() + ANSWERED_KEEP_MS }
                : c)));
            loadCalls();
        },
        // its order was taken on another screen: stop ringing here
        onCallTaken: (callId) => {
            setCalls((list) => list.filter((c) => c.callId !== callId));
            loadCalls();
        },
        onOrdersChanged: () => { load(); loadCalls(); },
        onCallsChanged: loadCalls,
    });

    // Ignored calls stop the sound and leave the popup, but still ring visually (top bar, bell)
    // and their order can be taken from the bell until their ring time is over.
    // Calls picked up on the phone don't ring at all; they wait in the popup for their order.
    const popupCalls = calls.filter((c) => !c.ignored);
    const ringing = calls.some((c) => !c.answered);
    useRingtone(popupCalls.some((c) => !c.answered), muted);

    const dropCall = useCallback((call) => setCalls((list) => list.filter((c) => c.callId !== call.callId)), []);
    const ignoreCalls = (ids) => setCalls((list) => list.map((c) => (ids.includes(c.callId) ? { ...c, ignored: true } : c)));

    // Unanswered for its ring time: stop ringing here, it is a missed call under the bell now
    // (picked up on the phone: after ANSWERED_KEEP_MS, it waits under the bell as "No order yet").
    useEffect(() => {
        const timers = calls.map((call) => window.setTimeout(() => {
            dropCall(call);
            loadCalls();
        }, Math.max(0, call.ringsUntil - Date.now())));
        return () => timers.forEach((t) => window.clearTimeout(t));
    }, [calls, dropCall, loadCalls]);

    // Opens another order / call in the modal. A half-written order is never replaced silently:
    // the user picks between discarding it and keeping it (the claimed call then waits under the bell).
    const openModal = (next, heldCall = null) => {
        if (modal && modalDirty.current) {
            setPendingSwitch({ next, heldCall });
            return;
        }
        setModal(next);
    };

    // Calls are answered on the phone; the first screen to take the order gets the call, every other screen stops ringing.
    const takeCallOrder = async (call) => {
        dropCall(call);
        if (!(await takeCall(call.callId))) {
            toast.warning(`The order for ${call.phone} is already being taken on another screen.`);
            return;
        }
        loadCalls();
        openModal({ call }, call);
    };

    const keepOpenOrder = () => {
        const { heldCall } = pendingSwitch;
        setPendingSwitch(null);
        if (heldCall) toast.info(`The order for ${heldCall.phone} waits under the bell - take it when you're done.`);
    };

    // From the bell: a call still ringing (also one ignored here). Same as the popup's Answer.
    const takeRingingFromBell = async (logged) => {
        const ringing = calls.find((c) => String(c.callId) === String(logged.recID));
        if (ringing) { takeCallOrder(ringing); return; }
        try {
            takeCallOrder(await getCall(logged.recID));
        } catch (e) {
            toast.error(apiErrorMessage(e, "The call couldn't be opened. Try again."));
        }
    };

    // From the bell: a missed or held call, looked up again so the client list is current.
    const takeOrderForCall = async (logged) => {
        try {
            openModal({ call: await getCall(logged.recID) });
        } catch (e) {
            toast.error(apiErrorMessage(e, "The call couldn't be opened. Try again."));
        }
    };

    const openOrderById = (recID) => {
        const order = orders.find((o) => Number(o.recID) === Number(recID));
        if (order) openModal({ order });
        else toast.warning(`Order #${recID} isn't in the list any more.`);
    };

    const handleCall = async (logged) => {
        setCallLog((list) => list.map((c) => (c.recID === logged.recID ? { ...c, status: "Handled" } : c)));
        try {
            await markCallHandled(logged.recID);
        } catch (e) {
            toast.error(apiErrorMessage(e, "The call couldn't be updated. Try again."));
            loadCalls();
        }
    };

    const setDirty = useCallback((dirty) => { modalDirty.current = dirty; }, []);

    const changeStatus = async (order, status) => {
        setOrders((list) => list.map((o) => (o.recID === order.recID ? { ...o, status } : o)));
        try {
            // the saved order: its completed date is set (or cleared) by the server
            const saved = await setOrderStatus(order.recID, status);
            if (saved) setOrders((list) => list.map((o) => (o.recID === saved.recID ? { ...saved, orderPlain: htmlToText(saved.orderText) } : o)));
            refreshStatuses();
        } catch (e) {
            toast.error(apiErrorMessage(e, `Order #${order.recID} couldn't be updated. Try again.`));
            load();
        }
    };

    // The date range applies first: the status counts are for those dates.
    const inDates = useMemo(() => orders.filter((o) => inDateRange(o.cdStamp, dates)), [orders, dates]);

    const counts = useMemo(() => {
        const c = { all: inDates.length, process: 0, ready: 0, delivery: 0, done: 0, custom: 0 };
        inDates.forEach((o) => { c[statusTone(o.status)] += 1; });
        return c;
    }, [inDates]);

    // "Other" goes away with its last order; don't stay on an empty filter then
    useEffect(() => { if (filter === "custom" && counts.custom === 0) setFilter("all"); }, [filter, counts.custom]);

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return inDates.filter((o) => {
            if (filter !== "all" && statusTone(o.status) !== filter) return false;
            if (!q) return true;
            return [o.status, o.orderPlain, o.clientName, o.phone, o.clientPhone1, o.clientPhone2, o.address, o.clientAddress, String(o.recID)]
                .some((v) => v && String(v).toLowerCase().includes(q));
        });
    }, [inDates, filter, search]);

    const { sorted, sort, toggle } = useSort(visible, SORT_COLUMNS, { key: "recID", dir: "desc" });

    // A new filter, search or sort starts again from the first page.
    useEffect(() => { setPage(1); }, [filter, search, dates, sort]);

    // Fewer rows than before (e.g. an order completed under the Open filter): stay on a real page.
    const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
    useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

    const pageRows = useMemo(() => sorted.slice((page - 1) * pageSize, page * pageSize), [sorted, page, pageSize]);

    const changePageSize = (size) => {
        setPageSize(size);
        setPage(1);
        try { localStorage.setItem(PAGE_SIZE_KEY, String(size)); } catch { /* per-browser preference only */ }
    };

    const runExport = async (kind) => {
        setExportOpen(false);
        if (!sorted.length) { toast.warning("There are no orders to export."); return; }
        const filterLabel = [
            `${FILTERS.find((f) => f.key === filter).label} orders`,
            describeDateRange(dates),
            search.trim() && `matching "${search.trim()}"`,
        ].filter(Boolean).join(" ");
        if (kind === "print") {
            await printOrdersReport(sorted, { filterLabel });
            return;
        }
        setExporting(true);
        try {
            await exportOrdersToExcel(sorted, { filterLabel });
        } catch (e) {
            console.error(e);
            toast.error("The Excel file couldn't be created. Try again.");
        } finally {
            setExporting(false);
        }
    };

    const print = async (order) => {
        await printOrder(order);
    };

    const onSaved = (saved, { print: andPrint }) => {
        setModal(null);
        toast.success(`Order #${saved.recID} saved.`);
        load();
        loadCalls();
        if (andPrint) print(saved);
    };

    return (
        <div className={`ord-app${ringing ? " is-ringing" : ""}`}>
            <header className="ord-topbar">
                <div className="ord-brand">
                    <span className="ord-brand-name">Orders</span>
                    {companyName && <span className="ord-brand-sub"><span className="ord-dot" />{companyName}</span>}
                </div>
                <div className="ord-topbar-actions">
                    <CallsBell
                        ringing={ringing}
                        history={callLog}
                        activeCallId={modal?.call?.callId}
                        onOpen={loadCalls}
                        onTakeRinging={takeRingingFromBell}
                        onTakeOrder={takeOrderForCall}
                        onOpenOrder={openOrderById}
                        onHandled={handleCall}
                    />
                    <span className={`ord-live${connected ? " is-on" : ""}`} title={connected ? "Caller-id connected" : "Caller-id disconnected - reconnecting"}>
                        <span className="ord-live-dot" /> {connected ? "Live" : "Offline"}
                    </span>
                    <button type="button" className="ds-btn ds-btn-icon" onClick={() => setMuted((m) => !m)} title={muted ? "Unmute ringtone" : "Mute ringtone"}>
                        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                    </button>
                    <button type="button" className="ds-btn ds-btn-icon" onClick={toggleTheme} title={isDark ? "Light theme" : "Dark theme"}>
                        {isDark ? <Sun size={18} /> : <Moon size={18} />}
                    </button>
                </div>
            </header>

            <main className="ord-main">
                <section className="ord-card">
                    <div className="ord-card-header">
                        <div className="ord-title">
                            <span className="ord-title-icon"><ClipboardList size={18} /></span>
                            <div>
                                <h1>Orders</h1>
                                <p>{counts.process} under process · {counts.ready} ready · {counts.delivery} to be delivered · {counts.done} completed</p>
                            </div>
                        </div>
                        <div className="ord-actions">
                            <div className="ds-menu-anchor" ref={exportRef}>
                                <button
                                    type="button"
                                    className="ds-btn ds-btn-secondary"
                                    aria-expanded={exportOpen}
                                    onClick={() => setExportOpen((o) => !o)}
                                    disabled={exporting}
                                >
                                    <Download size={16} />
                                    {exporting ? "Exporting..." : "Export"}
                                    <ChevronDown size={16} />
                                </button>
                                {exportOpen && (
                                    <div className="ds-menu ord-menu-right" role="menu">
                                        <button type="button" role="menuitem" className="ds-menu-item" onClick={() => runExport("excel")}>
                                            <FileSpreadsheet size={16} />
                                            Export to Excel
                                        </button>
                                        <button type="button" role="menuitem" className="ds-menu-item ord-menu-print" onClick={() => runExport("print")}>
                                            <Printer size={16} />
                                            Print report
                                        </button>
                                    </div>
                                )}
                            </div>
                            <button type="button" className="ds-btn ds-btn-primary" onClick={() => setModal({})}>
                                <Plus size={16} /> New
                            </button>
                        </div>
                    </div>

                    <div className="ord-toolbar">
                        <div className="ds-segmented">
                            {FILTERS.filter((f) => f.key !== "custom" || counts.custom > 0).map((f) => (
                                <button key={f.key} type="button" className={filter === f.key ? "is-active" : ""} onClick={() => setFilter(f.key)}>
                                    {f.label} <span className="ds-segmented-count">{counts[f.key]}</span>
                                </button>
                            ))}
                        </div>
                        <DateRange value={dates} onChange={setDates} />
                        <div className="ord-search ord-toolbar-search">
                            <Search size={16} className="ord-search-icon" />
                            <input className="ds-field" placeholder="Search orders, clients, phones..." value={search} onChange={(e) => setSearch(e.target.value)} />
                        </div>
                    </div>

                    <div className="ord-table-wrap">
                        <table className="ord-table">
                            <thead>
                                <tr>
                                    <SortTh label="#" sortKey="recID" sort={sort} onSort={toggle} style={{ width: 80 }} />
                                    <SortTh label="Client" sortKey="client" sort={sort} onSort={toggle} style={{ width: 220 }} />
                                    <SortTh label="Phone" sortKey="phone" sort={sort} onSort={toggle} style={{ width: 140 }} />
                                    <SortTh label="Order" sortKey="orderText" sort={sort} onSort={toggle} />
                                    <SortTh label="Created At" sortKey="created" sort={sort} onSort={toggle} style={{ width: 230 }} />
                                    <SortTh label="Status" sortKey="status" sort={sort} onSort={toggle} style={{ width: 170 }} />
                                    <th style={{ width: 84 }} />
                                </tr>
                            </thead>
                            <tbody>
                                {pageRows.map((o) => (
                                    <tr key={o.recID} className={isCompleted(o.status) ? "is-done" : ""} onDoubleClick={() => setModal({ order: o })}>
                                        <td className="ord-num">{o.recID}</td>
                                        <td>
                                            <div className="ord-cell-client">{o.clientName || <span className="ord-muted">Walk-in / unknown</span>}</div>
                                            {addressOf(o) && (
                                                <div className={`ord-cell-address${o.address ? " is-other" : ""}`} title={o.address ? "Delivery address for this order" : "Client's address"}>
                                                    <MapPin size={12} /> <span>{addressOf(o)}</span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="ord-num">{phoneOf(o) ?? ""}</td>
                                        <td><OrderText text={o.orderPlain} /></td>
                                        <td className="ord-num ord-muted">{formatDateTime(o.cdStamp)}</td>
                                        <td>
                                            <StatusPicker value={o.status} onChange={(status) => changeStatus(o, status)} />
                                            {o.completedAt && isCompleted(o.status) && (
                                                <div className="ord-completed-at" title="When it was set to Completed">{formatDateTime(o.completedAt)}</div>
                                            )}
                                        </td>
                                        <td className="ord-row-actions">
                                            <button type="button" className="ds-btn ds-btn-icon" onClick={() => print(o)} aria-label="Print order" title="Print">
                                                <Printer size={14} />
                                            </button>
                                            <button type="button" className="ds-btn ds-btn-icon" onClick={() => setModal({ order: o })} aria-label="Edit order" title="Edit">
                                                <Pencil size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!loading && sorted.length === 0 && (
                            <div className="ord-empty">
                                <em>{loadFailed ? "The orders couldn't be loaded." : orders.length ? "No order matches this filter." : "No orders yet."}</em>
                            </div>
                        )}
                        {loading && <div className="ord-empty"><em>Loading orders...</em></div>}
                    </div>

                    <div className="ord-table-footer">
                        <Pagination
                            page={page}
                            pageSize={pageSize}
                            total={sorted.length}
                            onPageChange={setPage}
                            onPageSizeChange={changePageSize}
                        />
                    </div>
                </section>
            </main>

            {modal && (
                <OrderModal
                    key={modal.order?.recID ?? modal.call?.callId ?? "new"}
                    initial={modal}
                    onClose={() => setModal(null)}
                    onSaved={onSaved}
                    onPrint={print}
                    onDirtyChange={setDirty}
                />
            )}

            {pendingSwitch && (
                <ConfirmDialog
                    title="You're in the middle of an order"
                    message={pendingSwitch.heldCall
                        ? `Discard the order you're writing and take the order for ${callerName(pendingSwitch.heldCall)} (${pendingSwitch.heldCall.phone})? If you keep writing, it waits under the bell.`
                        : "Discard the order you're writing and open this one instead?"}
                    confirmLabel="Discard & switch"
                    cancelLabel={pendingSwitch.heldCall ? "Keep writing, take it later" : "Keep writing"}
                    tone="danger"
                    onCancel={keepOpenOrder}
                    onConfirm={() => { setModal(pendingSwitch.next); setPendingSwitch(null); }}
                />
            )}

            <CallPopup
                calls={popupCalls}
                busy={!!modal}
                onTakeOrder={takeCallOrder}
                onIgnore={(call) => ignoreCalls([call.callId])}
                onIgnoreAll={() => ignoreCalls(popupCalls.map((c) => c.callId))}
            />
        </div>
    );
}

const LIST_MARKER = /^(•|\d+\.)\s/;

// The whole order on one line (typed lines separated by a dot), cut with "..." when too long; hover for all of it.
function OrderText({ text }) {
    const lines = orderLines(text);
    return (
        <div className="ord-text" title={lines.join("\n")}>
            {lines.map((line, i) => (
                <React.Fragment key={i}>
                    {/* a list item brings its own "•" / "1." marker; other lines get a dot between them */}
                    {i > 0 && (LIST_MARKER.test(line) ? " " : <span className="ord-text-sep" aria-hidden="true"> · </span>)}
                    <span className="ord-text-item">{line}</span>
                </React.Fragment>
            ))}
        </div>
    );
}
