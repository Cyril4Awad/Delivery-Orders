import React, { useEffect, useRef, useState } from "react";
import { ClipboardList, History, Lock, MapPin, Phone, PhoneIncoming, Printer, Save, Search, User, UserPlus, Users } from "lucide-react";
import Dialog from "../../ui/Dialog";
import ConfirmDialog from "../../ui/ConfirmDialog";
import ClientLookup from "./ClientLookup";
import RichTextEditor from "./RichTextEditor";
import { isBlankHtml, sanitizeHtml } from "./richText";
import { apiErrorMessage, getClientOrders, saveOrder } from "./ordersApi";
import StatusPicker, { DEFAULT_STATUS, isCompleted, statusTone } from "./StatusPicker";
import { useToaster } from "../../ui/toast/Toaster";
import { formatDateTime } from "../../utils/dates";

/*
 * New / edit order. `initial` may carry:
 *  - { order }: edit an existing order;
 *  - { call }:  from an answered call or the call history (match Found | Multiple | Unknown). One
 *               matching client is preselected; several are listed to pick from; an unknown
 *               caller opens the new-client form with the caller's number filled in and locked.
 *               The order is linked to the call when it saves.
 *
 * Left: the client. Modes: "existing" (picked from tbl_Clients - phone and address are
 * read-only), "choose" (several clients share the caller's number), "search" (lookup open),
 * "new" (name, phone and address typed in; created when the order saves).
 * Middle: the order - delivery address (the client's, or another one for this order only), the
 * order text (rich text, saved as cleaned-up HTML - see richText.js) and its status.
 * Right: the picked client's last 3 orders (the one being edited left out), so the user can see
 * what the caller usually orders and where earlier orders stand.
 *
 * Closing with unsaved changes asks first; `onDirtyChange` tells the page, so a call answered
 * meanwhile doesn't silently replace a half-written order.
 */
export default function OrderModal({ initial, onClose, onSaved, onPrint, onDirtyChange }) {
    const order = initial?.order;
    const call = initial?.call;
    const callClients = call?.clients ?? [];

    const [client, setClient] = useState(() => {
        if (order?.clientID != null) {
            return {
                loc: order.clientLoc, recID: order.clientID, nbr: order.clientNbr, name: order.clientName,
                phone1: order.clientPhone1, phone2: order.clientPhone2, address: order.clientAddress,
            };
        }
        return call?.match === "Found" ? callClients[0] : null;
    });
    const [mode, setMode] = useState(() => {
        if (order) return order.clientID != null ? "existing" : "search";
        if (call?.match === "Found") return "existing";
        if (call?.match === "Multiple") return "choose";
        if (call) return "new";
        return "search";
    });
    const [newClient, setNewClient] = useState({ name: "", phone: call ? call.phone : "", address: "" });
    const [otherAddress, setOtherAddress] = useState(order?.address ?? "");
    const [useOtherAddress, setUseOtherAddress] = useState(!!order?.address);
    const [text, setText] = useState(order?.orderText ?? "");
    const [status, setStatus] = useState(order?.status || DEFAULT_STATUS);
    const [saving, setSaving] = useState(false);
    const [pickerOnOpen, setPickerOnOpen] = useState(false);
    const [confirmPrint, setConfirmPrint] = useState(false);
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const toast = useToaster();

    // Unsaved changes: what would be saved, against what the modal opened with.
    const snapshot = JSON.stringify({
        client: mode === "existing" && client ? `${client.loc}-${client.recID}` : null,
        newClient: [newClient.name.trim(), newClient.phone.trim(), newClient.address.trim()],
        address: useOtherAddress ? otherAddress.trim() : null,
        text: isBlankHtml(text) ? "" : sanitizeHtml(text),
        status,
    });
    const initialSnapshot = useRef(snapshot);
    const dirty = snapshot !== initialSnapshot.current;

    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    const requestClose = () => {
        if (saving) return;
        if (dirty) setConfirmDiscard(true);
        else onClose();
    };

    // "Search existing client" / "Other client": straight to the client picker dialog.
    const searchExisting = () => {
        setClient(null);
        setPickerOnOpen(true);
        setMode("search");
    };

    // Changing the client goes back to the caller's matches when there were several.
    const pickClient = (c) => {
        setClient(c);
        setMode(c ? "existing" : call?.match === "Multiple" ? "choose" : "search");
    };

    const isCallClient = (c) => !!c && callClients.some((m) => m.loc === c.loc && m.recID === c.recID);

    const setNew = (key) => (e) => setNewClient((n) => ({ ...n, [key]: e.target.value }));

    // The number the order is for: the caller's, else the client's own.
    const orderPhone = () => {
        if (mode === "new") return newClient.phone.trim();
        if (isCallClient(client)) return call.phone;
        if (order?.phone && client?.recID === order.clientID) return order.phone;
        return client?.phone1?.trim() || client?.phone2?.trim() || null;
    };

    const lastOrders = useLastOrders(mode === "existing" ? client : null, order?.recID);

    const clientAddress = mode === "new" ? newClient.address.trim() : mode === "existing" ? client?.address?.trim() : "";

    const submit = async (print) => {
        if (order && !dirty) {
            if (print) setConfirmPrint(true);
            else toast.error("No Changes To Save");
            return;
        }
        if (mode === "search" || mode === "choose") { toast.error("Pick a client or create a new one."); return; }
        if (mode === "new" && !newClient.name.trim()) { toast.error("Client name is required."); return; }
        if (mode === "new" && !newClient.phone.trim()) { toast.error("Client phone is required."); return; }
        if (useOtherAddress && !otherAddress.trim()) { toast.error("Enter the delivery address, or deliver to the client's address."); return; }
        if (isBlankHtml(text)) { toast.error("Order text is required."); return; }

        setSaving(true);
        try {
            const saved = await saveOrder({
                recID: order?.recID ?? null,
                clientLoc: mode === "existing" ? client.loc : null,
                clientID: mode === "existing" ? client.recID : null,
                newClient: mode === "new"
                    ? { name: newClient.name.trim(), phone: newClient.phone.trim(), address: newClient.address.trim() || null }
                    : null,
                phone: orderPhone(),
                address: useOtherAddress ? otherAddress.trim() : null,
                orderText: sanitizeHtml(text),
                status,
                callID: call?.callId ? Number(call.callId) : null,
            });
            onSaved(saved, { print });
        } catch (err) {
            toast.error(apiErrorMessage(err, "The order couldn't be saved. Try again."));
            setSaving(false);
        }
    };

    const title = order ? `Order #${order.recID}` : call ? `Order for ${call.phone}` : "New order";
    const subtitle = call
        ? call.match === "Unknown" ? "New caller - fill in the client details."
            : call.match === "Multiple" ? `${callClients.length} clients share this number - pick the caller.`
            : "Caller found - write the order."
        : order ? "Edit the order details." : "Pick the client and write the order.";

    return (
        <Dialog
            title={title}
            subtitle={subtitle}
            icon={call ? PhoneIncoming : ClipboardList}
            onClose={requestClose}
            closeOnScrim={false}
            size="xl"
            className="ord-modal"
            bodyClassName="ord-modal-body"
            footer={
                <>
                    <button type="button" className="ds-btn ds-btn-secondary" onClick={requestClose}>Cancel</button>
                    <button type="button" className="ds-btn ds-btn-secondary" disabled={saving} onClick={() => submit(true)}>
                        <Printer size={16} /> Save &amp; Print
                    </button>
                    <button type="button" className="ds-btn ds-btn-success" disabled={saving} onClick={() => submit(false)}>
                        <Save size={16} /> {saving ? "Saving..." : "Save order"}
                    </button>
                </>
            }
        >
            <form className="ord-form" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
                {/* ---------- Left: the client ---------- */}
                <section className="ord-pane ord-pane-client" aria-label="Client">
                    <div className="ord-pane-head">
                        <h3 className="ord-pane-title"><User size={16} /> Client<span className="ds-req">*</span></h3>
                        {(mode === "search" || mode === "choose") && (
                            <span className="ord-links">
                                {mode === "choose" && (
                                    <button type="button" className="ds-btn ds-btn-secondary ord-btn-sm" onClick={searchExisting}>
                                        <Search size={14} /> Other
                                    </button>
                                )}
                                <button type="button" className="ds-btn ds-btn-secondary ord-btn-sm" onClick={() => setMode("new")}>
                                    <UserPlus size={14} /> New client
                                </button>
                            </span>
                        )}
                        {mode === "new" && (
                            <button type="button" className="ds-btn ds-btn-secondary ord-btn-sm" onClick={searchExisting}>
                                <Search size={14} /> Existing client
                            </button>
                        )}
                    </div>

                    {call && (
                        <div className="ord-caller">
                            <PhoneIncoming size={16} />
                            <span>Caller</span>
                            <strong className="ord-num">{call.phone}</strong>
                        </div>
                    )}

                    {mode === "choose" && (
                        <div className="ord-choose" role="listbox" aria-label="Clients with this number">
                            <span className="ds-hint ord-locked"><Users size={12} /> {callClients.length} clients have this number. Pick the caller:</span>
                            {callClients.map((c) => (
                                <button type="button" key={`${c.loc}-${c.recID}`} className="ord-choose-item" onClick={() => pickClient(c)}>
                                    <span className="ord-client-avatar is-sm"><User size={14} /></span>
                                    <span className="ord-choose-info">
                                        <span className="ord-client-name">{c.name?.trim()}</span>
                                        <span className="ord-client-phones">
                                            {[c.phone1, c.phone2].filter((p) => p && p.trim()).map((p) => (
                                                <span key={p} className="ord-phone"><Phone size={12} /> {p}</span>
                                            ))}
                                        </span>
                                        {c.address && <span className="ord-client-address">{c.address}</span>}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}

                    {(mode === "existing" || mode === "search") && (
                        <ClientLookup value={mode === "existing" ? client : null} onChange={pickClient} autoFocus={mode === "search"} openOnMount={pickerOnOpen} />
                    )}
                    {mode === "existing" && (
                        <span className="ds-hint ord-locked"><Lock size={12} /> Existing client - phone and address can't be changed here.</span>
                    )}

                    {mode === "new" && (
                        <div className="ord-new-client">
                            <div className="ds-form-field">
                                <label className="ds-label" htmlFor="ord-nc-name">Name<span className="ds-req">*</span></label>
                                <input id="ord-nc-name" className="ds-field" placeholder="e.g. Charbel Haddad" value={newClient.name} onChange={setNew("name")} maxLength={LIMITS.clientName} autoFocus />
                            </div>
                            <div className="ds-form-field">
                                <label className="ds-label" htmlFor="ord-nc-phone">Phone<span className="ds-req">*</span></label>
                                <input
                                    id="ord-nc-phone"
                                    className="ds-field"
                                    placeholder="e.g. 70 123 456"
                                    value={newClient.phone}
                                    onChange={setNew("phone")}
                                    maxLength={LIMITS.phone}
                                    readOnly={!!call}
                                    disabled={!!call}
                                />
                                {call && <span className="ds-hint ord-locked"><Lock size={12} /> The caller's number.</span>}
                            </div>
                            <div className="ds-form-field">
                                <label className="ds-label" htmlFor="ord-nc-address">Address</label>
                                <textarea
                                    id="ord-nc-address"
                                    className="ds-field ord-address-input"
                                    placeholder="e.g. Zouk Mosbeh, main road, building 4, 2nd floor"
                                    value={newClient.address}
                                    onChange={setNew("address")}
                                    maxLength={LIMITS.clientAddress}
                                />
                                <CharCount value={newClient.address} max={LIMITS.clientAddress} />
                            </div>
                            <span className="ds-hint">The client is created when the order is saved.</span>
                        </div>
                    )}
                </section>

                {/* ---------- Right: the order ---------- */}
                <section className="ord-pane ord-pane-order" aria-label="Order">
                    <div className="ds-form-field">
                        <div className="ord-label-row">
                            <span className="ds-label"><MapPin size={14} className="ord-label-icon" /> Delivery address</span>
                            <div className="ds-segmented ord-seg-sm" role="radiogroup" aria-label="Delivery address">
                                <button type="button" role="radio" aria-checked={!useOtherAddress} className={!useOtherAddress ? "is-active" : ""} onClick={() => setUseOtherAddress(false)}>
                                    Client's address
                                </button>
                                <button type="button" role="radio" aria-checked={useOtherAddress} className={useOtherAddress ? "is-active" : ""} onClick={() => setUseOtherAddress(true)}>
                                    Other address
                                </button>
                            </div>
                        </div>
                        {useOtherAddress ? (
                            <>
                                <textarea
                                    className="ds-field ord-address-input"
                                    placeholder="Where this order goes, e.g. Jounieh, Kaslik street, office 3"
                                    value={otherAddress}
                                    onChange={(e) => setOtherAddress(e.target.value)}
                                    maxLength={LIMITS.orderAddress}
                                    autoFocus
                                />
                                <span className="ds-hint ord-hint-row">
                                    For this order only - the client's own address is not changed.
                                    <CharCount value={otherAddress} max={LIMITS.orderAddress} />
                                </span>
                            </>
                        ) : (
                            <div className="ord-address-view">
                                {clientAddress || <span className="ord-muted">{mode === "existing" || mode === "new" ? "No address on file for this client." : "Pick the client first."}</span>}
                            </div>
                        )}
                    </div>

                    <div className="ds-form-field ord-order-field">
                        <span className="ds-label">Order<span className="ds-req">*</span></span>
                        <RichTextEditor
                            id="ord-text"
                            className="ord-order-editor"
                            placeholder="e.g. 2 kg tomatoes, 1 bread, 6 water bottles"
                            value={text}
                            autoFocus={mode === "existing"}
                            onChange={setText}
                            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(false); } }}
                        />
                        <span className="ds-hint">Ctrl + Enter to save.</span>
                    </div>

                    <div className="ds-form-field ord-status-field">
                        <label className="ds-label" htmlFor="ord-status">Status</label>
                        <StatusPicker id="ord-status" variant="field" value={status} onChange={setStatus} />
                        <span className="ds-hint">
                            {order?.completedAt && isCompleted(status) && status === order.status
                                ? `Completed on ${formatDateTime(order.completedAt)}.`
                                : "Pick one, or type a new status - it's added to the list."}
                        </span>
                    </div>
                </section>

                {/* ---------- Right: the client's last orders ---------- */}
                <LastOrders state={lastOrders} hasClient={mode === "existing" && !!client} />
            </form>

            {confirmPrint && (
                <ConfirmDialog
                    title="No Changes To Save"
                    message="Nothing changed on this order. Print it as it is, without saving?"
                    confirmLabel="Print Only"
                    onCancel={() => setConfirmPrint(false)}
                    onConfirm={() => { setConfirmPrint(false); onPrint(order); }}
                />
            )}

            {confirmDiscard && (
                <ConfirmDialog
                    title="Discard changes?"
                    message={order ? `Your changes to order #${order.recID} will be lost.` : "The order you're writing will be lost."}
                    confirmLabel="Discard"
                    cancelLabel="Keep editing"
                    tone="danger"
                    onCancel={() => setConfirmDiscard(false)}
                    onConfirm={() => { setConfirmDiscard(false); onClose(); }}
                />
            )}
        </Dialog>
    );
}

// Column sizes (backend FieldLimits): the fields don't take more than the database holds.
const LIMITS = { clientName: 200, phone: 50, clientAddress: 300, orderAddress: 500 };

// "120 / 500", shown once a long field gets near its limit.
function CharCount({ value, max }) {
    const n = value?.length ?? 0;
    if (n < max * 0.8) return null;
    return <span className={`ord-char-count${n >= max ? " is-full" : ""}`}>{n} / {max}</span>;
}

const LAST_ORDERS = 3;

// The picked client's latest orders: { loading, failed, items }; reloaded when the client changes.
function useLastOrders(client, exceptId) {
    const [state, setState] = useState({ loading: false, failed: false, items: [] });
    const loc = client?.loc;
    const id = client?.recID;
    useEffect(() => {
        if (loc == null || id == null) { setState({ loading: false, failed: false, items: [] }); return undefined; }
        const ctrl = new AbortController();
        setState({ loading: true, failed: false, items: [] });
        getClientOrders(loc, id, { take: LAST_ORDERS, exceptId, signal: ctrl.signal })
            .then((items) => setState({ loading: false, failed: false, items }))
            .catch((e) => { if (e.name !== "AbortError") setState({ loading: false, failed: true, items: [] }); });
        return () => ctrl.abort();
    }, [loc, id, exceptId]);
    return state;
}

function LastOrders({ state, hasClient }) {
    return (
        <section className="ord-pane ord-pane-history" aria-label="Last orders">
            <div className="ord-pane-head">
                <h3 className="ord-pane-title"><History size={16} /> Last {LAST_ORDERS} orders</h3>
            </div>
            {!hasClient && <div className="ord-history-empty">Pick the client to see their last orders.</div>}
            {hasClient && state.loading && <div className="ord-history-empty">Loading...</div>}
            {hasClient && state.failed && <div className="ord-history-empty">The last orders couldn't be loaded.</div>}
            {hasClient && !state.loading && !state.failed && state.items.length === 0 && (
                <div className="ord-history-empty">No earlier orders for this client.</div>
            )}
            {state.items.map((o) => (
                <article key={o.recID} className="ord-history-card">
                    <header className="ord-history-head">
                        <span className="ord-history-no">#{o.recID}</span>
                        <span className="ord-history-date">{formatDateTime(o.cdStamp)}</span>
                        <span className={`ord-status is-${statusTone(o.status)} is-static`}>
                            <span className="ord-status-text">{o.status}</span>
                        </span>
                    </header>
                    {/* sanitized again here: it is shown as HTML */}
                    <div className="ord-history-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(o.orderText) }} />
                    {o.address && (
                        <div className="ord-history-address"><MapPin size={13} /> {o.address}</div>
                    )}
                </article>
            ))}
        </section>
    );
}
