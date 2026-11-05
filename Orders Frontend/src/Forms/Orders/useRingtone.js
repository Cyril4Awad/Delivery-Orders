import { useEffect, useRef } from "react";

/*
 * Plays a classic double-ring (two short 440/480 Hz bursts every 3s) while `active` is true.
 * Uses WebAudio so no audio file is needed. Browsers only allow sound after the user has
 * interacted with the page once; until then the ring is visual only.
 */
export function useRingtone(active, muted) {
    const ctxRef = useRef(null);

    useEffect(() => {
        if (!active || muted) return undefined;

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return undefined;
        if (!ctxRef.current) ctxRef.current = new AudioCtx();
        const ctx = ctxRef.current;
        ctx.resume?.().catch(() => {});

        const burst = (start, length) => {
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
            gain.gain.setValueAtTime(0.12, start + length - 0.02);
            gain.gain.linearRampToValueAtTime(0, start + length);
            gain.connect(ctx.destination);
            [440, 480].forEach((freq) => {
                const osc = ctx.createOscillator();
                osc.frequency.value = freq;
                osc.connect(gain);
                osc.start(start);
                osc.stop(start + length);
            });
        };

        const ring = () => {
            const t = ctx.currentTime + 0.05;
            burst(t, 0.4);
            burst(t + 0.6, 0.4);
        };

        ring();
        const timer = window.setInterval(ring, 3000);
        return () => window.clearInterval(timer);
    }, [active, muted]);
}
