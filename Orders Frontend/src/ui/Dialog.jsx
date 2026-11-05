import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./ui.css";
import "./dialog.css";

// Open dialogs, innermost last - only the top one reacts to Escape.
const stack = [];

/*
 * Design-system dialog: scrim, header (icon, title, subtitle, close), scrolling body,
 * optional footer. `onClose` is a request - the caller decides (e.g. confirm discard).
 *
 * size: "sm" (420) | "md" (640) | "lg" (880) | "xl" (1180)
 */
export default function Dialog({
    title,
    subtitle,
    icon: Icon,
    headerExtra,
    onClose,
    footer,
    size = "md",
    children,
    bodyClassName = "",
    className = "",
    closeOnScrim = true,
    initialFocusRef,
}) {
    const idRef = useRef(Symbol("dialog"));
    const panelRef = useRef(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    // read while rendering: the children's effects (e.g. an autofocused editor) run before ours
    const previouslyFocusedRef = useRef(null);
    if (previouslyFocusedRef.current === null) previouslyFocusedRef.current = document.activeElement;

    useEffect(() => {
        const id = idRef.current;
        stack.push(id);
        const previouslyFocused = previouslyFocusedRef.current;
        // a field inside already took the focus (autoFocus): leave it there, caret and all
        if (!panelRef.current?.contains(document.activeElement)) {
            const target = initialFocusRef?.current || panelRef.current;
            target?.focus?.({ preventScroll: true });
        }

        const onKey = (e) => {
            if (e.key !== "Escape" || stack[stack.length - 1] !== id) return;
            e.preventDefault();
            onCloseRef.current?.();
        };
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            const i = stack.indexOf(id);
            if (i >= 0) stack.splice(i, 1);
            previouslyFocused?.focus?.({ preventScroll: true });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return createPortal(
        <div
            className="ds-dialog-scrim"
            onMouseDown={(e) => {
                if (closeOnScrim && e.target === e.currentTarget) onCloseRef.current?.();
            }}
        >
            <div
                ref={panelRef}
                className={`ds-dialog is-${size} ${className}`}
                role="dialog"
                aria-modal="true"
                aria-label={typeof title === "string" ? title : undefined}
                tabIndex={-1}
            >
                <header className="ds-dialog-header">
                    {Icon && <span className="ds-dialog-icon"><Icon size={20} /></span>}
                    <div className="ds-dialog-titles">
                        <h2 className="ds-dialog-title">{title}</h2>
                        {subtitle && <p className="ds-dialog-subtitle">{subtitle}</p>}
                    </div>
                    {headerExtra}
                    {onClose && (
                        <button type="button" className="ds-btn ds-btn-icon" onClick={() => onCloseRef.current?.()} aria-label="Close">
                            <X size={18} />
                        </button>
                    )}
                </header>
                <div className={`ds-dialog-body ${bodyClassName}`}>{children}</div>
                {footer && <footer className="ds-dialog-footer">{footer}</footer>}
            </div>
        </div>,
        document.body
    );
}
