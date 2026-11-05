import { getApiBase } from "../../globals";

// Failed request: the HTTP status and the server's message ({ error } from GlobalExceptionFilter).
export class ApiError extends Error {
    constructor(status, serverMessage, forUser = false) {
        super(serverMessage || `Request failed (${status})`);
        this.status = status;
        this.serverMessage = serverMessage;
        // the server wrote the message for the screen (database unreachable, out of date...): shown even on a 5xx
        this.forUser = forUser;
    }
}

async function request(path, options = {}) {
    let resp;
    try {
        resp = await fetch(`${getApiBase()}${path}`, {
            headers: { "Content-Type": "application/json" },
            ...options,
        });
    } catch (e) {
        if (e.name === "AbortError") throw e;
        throw new ApiError(0, null);
    }
    const text = await resp.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!resp.ok) {
        const firstValidation = body?.errors && Object.values(body.errors).flat()[0];
        // an HTML error page (IIS, wrong API_BASE) is no message for a toast
        const textMessage = typeof body === "string" && !/^\s*</.test(body) ? body : null;
        throw new ApiError(resp.status, (typeof body === "string" ? textMessage : body?.error) || firstValidation || body?.title || null, !!body?.forUser);
    }
    return body;
}

/**
 * A message fit for a toast. Validation (400) and not-found (404) messages are written for the
 * user and shown as they are; server faults (500) show the caller's plain fallback instead of
 * the technical text, which goes to the console - unless the server marked its message forUser.
 */
export function apiErrorMessage(error, fallback = "Something went wrong. Try again.") {
    if (error?.status === 0) return "Can't reach the server. Check that the Orders service is running.";
    // IIS's WebDAV module answers PUT / DELETE itself (the app's web.config removes it)
    if (error?.status === 405) return "The web server blocked this change (405). Remove WebDAV from the Orders site in IIS.";
    if (error?.status && (error.status < 500 || error.forUser) && error.serverMessage) return error.serverMessage;
    if (error?.serverMessage) console.error(error.serverMessage);
    return fallback;
}

export const getOrders = () => request("/Orders");

export const saveOrder = (order) =>
    request("/Orders", { method: "POST", body: JSON.stringify(order) });

// "Under process" | "Ready" | "Completed", or any status typed in; returns the saved order.
export const setOrderStatus = (recId, status) =>
    request(`/Orders/${recId}/status`, { method: "PUT", body: JSON.stringify({ status }) });

// The statuses offered (tbl_OrderStatus), in their order: [{ recID, name, sortOrder }].
export const getStatuses = () => request("/Orders/Statuses");

// Every status an order had, oldest first: [{ recID, orderID, status, date, user }].
export const getStatusLog = (recId) => request(`/Orders/${recId}/StatusLog`);

// The client's latest orders, newest first; `exceptId` (the order being edited) is left out.
export const getClientOrders = (loc, id, { take = 3, exceptId = null, signal } = {}) => {
    const qs = new URLSearchParams({ take: String(take) });
    if (exceptId != null) qs.set("exceptId", String(exceptId));
    return request(`/Orders/Clients/${encodeURIComponent(loc)}/${id}/Orders?${qs}`, { signal });
};

// Call history (bell), newest first: { recID, phone, match, matchCount, clientName,
// status: Ringing | Answered | Missed | Handled | Ordered, orderID, receivedAt, takenAt }
// Filters, across the whole history: `search` = a number (any spacing) or a client name;
// `from` / `to` = "YYYY-MM-DD", the days the calls came in (both included).
export const getCalls = (take = 100, { search = "", from = "", to = "" } = {}) => {
    const qs = new URLSearchParams({ take: String(take) });
    if (search) qs.set("search", search);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return request(`/Orders/Calls?${qs}`);
};

// A logged call with its caller looked up again (same shape as the "IncomingCall" event), to take an order for it now.
export const getCall = (id) => request(`/Orders/Calls/${id}`);

export const markCallHandled = (id) => request(`/Orders/Calls/${id}/handled`, { method: "PUT" });

// One page of clients: { items, total }
export const searchClients = ({ search, page = 1, pageSize = 25 }) =>
    request(`/Orders/Clients?search=${encodeURIComponent(search ?? "")}&page=${page}&pageSize=${pageSize}`);

// SignalR hub (Main/Hubs/OrdersHub.cs) - the API base without its trailing "/api".
export const hubUrl = () => `${getApiBase().replace(/\/api\/?$/, "")}/hubs/orders`;
