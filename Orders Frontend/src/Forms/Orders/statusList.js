import { useEffect, useState } from "react";
import { getStatuses } from "./ordersApi";

/*
 * The statuses the pickers offer, from tbl_OrderStatus (GET /Orders/Statuses), shared by every
 * StatusPicker on the page. A status typed in is added to the table by the backend when an order
 * is saved with it, so refreshStatuses() runs after saves and when another screen changed orders.
 * Until the first load answers (or when it fails), the four built-in statuses are offered.
 */

export const BUILT_IN_STATUSES = ["Under process", "Ready", "Ready to be delivered", "Completed"];

let statuses = BUILT_IN_STATUSES;
let loading = null;
const listeners = new Set();

export function refreshStatuses() {
    loading ??= getStatuses()
        .then((rows) => {
            const names = (rows ?? []).map((r) => r.name).filter(Boolean);
            if (names.length) {
                statuses = names;
                listeners.forEach((l) => l());
            }
        })
        .catch(() => { /* keep the list we have; orders loading reports connection problems */ })
        .finally(() => { loading = null; });
    return loading;
}

/** The offered statuses; loads them the first time a picker shows. */
export function useStatuses() {
    const [list, setList] = useState(statuses);
    useEffect(() => {
        const listener = () => setList(statuses);
        listeners.add(listener);
        listener(); // changed between the first render and now
        if (statuses === BUILT_IN_STATUSES) refreshStatuses();
        return () => { listeners.delete(listener); };
    }, []);
    return list;
}
