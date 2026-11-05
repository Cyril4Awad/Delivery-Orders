import { useCallback, useEffect, useRef, useState } from "react";
import { HubConnectionBuilder, HubConnectionState, LogLevel } from "@microsoft/signalr";
import { hubUrl } from "./ordersApi";

/*
 * Live connection to the backend's SignalR hub (/hubs/orders). The server puts every screen in
 * its location's group and calls:
 * - "IncomingCall"  { callId, phone, match: Unknown|Found|Multiple, clients } -> handlers.onIncomingCall(call)
 * - "CallTaken"     { callId }  another screen answered it                    -> handlers.onCallTaken(callId)
 * - "OrdersChanged" { recId }                                                -> handlers.onOrdersChanged()
 * - "CallAnswered"  { callId }  picked up on the phone (stop ringing)        -> handlers.onCallAnswered(callId)
 * - "CallsChanged"  { callId }  a call was marked handled / missed            -> handlers.onCallsChanged()
 * takeCall(callId) claims a call for this screen: true when it got it, false when another
 * screen was first. Reconnects on its own (and keeps retrying after a long outage);
 * `connected` drives the Live badge.
 */
export function useOrdersHub(handlers) {
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;
    const [connected, setConnected] = useState(false);
    const connectionRef = useRef(null);

    useEffect(() => {
        const connection = new HubConnectionBuilder()
            .withUrl(hubUrl())
            .withAutomaticReconnect({ nextRetryDelayInMilliseconds: (ctx) => Math.min(30000, 1000 * 2 ** ctx.previousRetryCount) })
            .configureLogging(LogLevel.Warning)
            .build();
        connectionRef.current = connection;

        connection.on("IncomingCall", (call) => handlersRef.current.onIncomingCall?.(call));
        connection.on("CallTaken", (m) => handlersRef.current.onCallTaken?.(m?.callId));
        connection.on("OrdersChanged", () => handlersRef.current.onOrdersChanged?.());
        connection.on("CallAnswered", (m) => handlersRef.current.onCallAnswered?.(m?.callId));
        connection.on("CallsChanged", () => handlersRef.current.onCallsChanged?.());
        connection.onreconnecting(() => setConnected(false));
        connection.onreconnected(() => {
            setConnected(true);
            handlersRef.current.onOrdersChanged?.(); // catch up on anything missed while offline
        });

        let stopped = false;
        let retryTimer = null;
        const start = async () => {
            try {
                await connection.start();
                if (!stopped) setConnected(true);
            } catch {
                if (!stopped) retryTimer = window.setTimeout(start, 5000);
            }
        };
        // automatic reconnect gives up eventually; start over so the screen never stays deaf
        connection.onclose(() => {
            setConnected(false);
            if (!stopped) retryTimer = window.setTimeout(start, 5000);
        });

        start();
        return () => {
            stopped = true;
            window.clearTimeout(retryTimer);
            if (connection.state !== HubConnectionState.Disconnected) connection.stop();
        };
    }, []);

    const takeCall = useCallback(async (callId) => {
        const connection = connectionRef.current;
        // offline: can't ask the others, so this screen keeps the call
        if (connection?.state !== HubConnectionState.Connected) return true;
        try {
            return await connection.invoke("TakeCall", callId);
        } catch {
            return true;
        }
    }, []);

    return { connected, takeCall };
}
