import React, { useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardList, PhoneCall, PhoneIncoming, PhoneOff } from "lucide-react";

// An order being written gets only the newest call on top of it, so the form stays usable.
const MAX_SHOWN = 3;
const MAX_SHOWN_BUSY = 1;

// match: Found (one client), Multiple (the user picks one when answering), Unknown (new client)
export function callerName(call) {
    const clients = call.clients ?? [];
    if (call.match === "Found") return clients[0]?.name?.trim() || "Client";
    if (call.match === "Multiple") return `${clients.length} clients share this number`;
    return "Unknown caller";
}

// The ring-time bar starts where the call really is (a card shown again later doesn't restart it).
function timerStyle(call) {
    const total = call.ringSeconds || 45;
    const left = call.ringsUntil ? Math.max(0, (call.ringsUntil - Date.now()) / 1000) : total;
    return { animationDuration: `${total}s`, animationDelay: `${-(total - left)}s` };
}

/*
 * Ringing calls, top center, above everything (an open order included) so a call is never
 * missed while typing. Newest first; each card counts down its ring time, after which the
 * page drops it and it shows under the bell as missed. Ignored calls leave the popup but keep
 * ringing in the top bar and the bell, where their order can still be taken. Calls are answered
 * on the phone itself; "Take order" here only claims the caller's order for this screen.
 * Large so a call can't be overlooked; compact (the old size) while an order is open, so the
 * order form under it stays readable.
 */
export default function CallPopup({ calls, busy, onTakeOrder, onIgnore, onIgnoreAll }) {
    if (!calls.length) return null;
    const shown = [...calls].reverse().slice(0, busy ? MAX_SHOWN_BUSY : MAX_SHOWN);
    const hidden = calls.length - shown.length;

    return createPortal(
        <div className={`ord-callpop${busy ? " is-compact" : ""}`} role="region" aria-label="Incoming calls" aria-live="assertive">
            {shown.map((call) => (
                <CallCard key={call.callId} call={call} busy={busy} onTakeOrder={onTakeOrder} onIgnore={onIgnore} />
            ))}
            {hidden > 0 && (
                <div className="ord-callpop-more">
                    <span>+{hidden} more ringing</span>
                    <button type="button" onClick={onIgnoreAll} title="Silence them - take their orders later from the bell">Ignore all</button>
                </div>
            )}
        </div>,
        document.body
    );
}

function CallCard({ call, busy, onTakeOrder, onIgnore }) {
    // fixed when the card appears: a style changed while the bar animates would make it jump
    const [timer] = useState(() => timerStyle(call));
    return (
        <div className={`ord-callpop-card${call.answered ? " is-answered" : ""}`}>
            <span className="ord-callpop-icon" aria-hidden="true">{call.answered ? <PhoneCall /> : <PhoneIncoming />}</span>
            <div className="ord-callpop-text">
                <span className="ord-callpop-label">
                    {call.answered ? "Answered on the phone · take the order" : "Incoming call"}
                    {busy ? " · you have an order open" : ""}
                </span>
                <span className="ord-callpop-who">{callerName(call)}</span>
                <span className="ord-callpop-number">{call.phone}</span>
            </div>
            <div className="ord-callpop-actions">
                <button type="button" className="ds-btn ord-callpop-ignore" onClick={() => onIgnore(call)}
                    title={call.answered ? "Hide it - take its order later from the bell" : "Stop the sound - take its order later from the bell"}>
                    <PhoneOff /> {call.answered ? "Later" : "Ignore"}
                </button>
                <button type="button" className="ds-btn ord-callpop-answer" onClick={() => onTakeOrder(call)}>
                    <ClipboardList /> Take order
                </button>
            </div>
            {!call.answered && <span className="ord-callpop-timer" style={timer} aria-hidden="true" />}
        </div>
    );
}
