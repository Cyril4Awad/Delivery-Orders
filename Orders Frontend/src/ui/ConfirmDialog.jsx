import React, { useRef } from "react";
import Dialog from "./Dialog";

/** Yes/no confirmation. `tone="danger"` for destructive actions. */
export default function ConfirmDialog({
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    tone = "primary",
    busy = false,
    onConfirm,
    onCancel,
}) {
    const cancelRef = useRef(null);
    return (
        <Dialog
            title={title}
            size="sm"
            onClose={busy ? undefined : onCancel}
            initialFocusRef={cancelRef}
            footer={(
                <>
                    <button ref={cancelRef} type="button" className="ds-btn ds-btn-secondary" onClick={onCancel} disabled={busy}>
                        {cancelLabel}
                    </button>
                    <button type="button" className={`ds-btn ds-btn-${tone}`} onClick={onConfirm} disabled={busy}>
                        {busy ? "Working…" : confirmLabel}
                    </button>
                </>
            )}
        >
            <div className="ds-confirm-text">{message}</div>
        </Dialog>
    );
}
