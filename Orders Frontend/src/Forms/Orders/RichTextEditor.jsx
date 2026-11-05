import React, { useEffect, useRef, useState } from "react";
import { Bold, Highlighter, Italic, List, ListOrdered, RemoveFormatting, Strikethrough, Underline } from "lucide-react";
import { sanitizeHtml } from "./richText";

const COLORS = [
    { label: "Default color", value: null },
    { label: "Red", value: "#dc2626" },
    { label: "Orange", value: "#ea580c" },
    { label: "Green", value: "#16a34a" },
    { label: "Blue", value: "#2563eb" },
];
const HIGHLIGHT = "#fde68a";
// an unlikely color, applied then removed to get back to the default text color
const DEFAULT_MARKER = "#010203";
const DEFAULT_MARKER_RGB = "rgb(1, 2, 3)";

const MARKS = [
    { command: "bold", icon: Bold, label: "Bold (Ctrl+B)" },
    { command: "italic", icon: Italic, label: "Italic (Ctrl+I)" },
    { command: "underline", icon: Underline, label: "Underline (Ctrl+U)" },
    { command: "strikeThrough", icon: Strikethrough, label: "Strikethrough" },
];
const LISTS = [
    { command: "insertUnorderedList", icon: List, label: "Bullet list" },
    { command: "insertOrderedList", icon: ListOrdered, label: "Numbered list" },
];

/*
 * Rich text box: bold / italic / underline / strike, a few text colors, highlight, lists and
 * clear formatting. contentEditable + execCommand (no editor library); styles are written as
 * inline CSS so sanitizeHtml (richText.js) can keep them. Pasted content is cleaned the same way.
 * Uncontrolled: `value` is read when it mounts, `onChange(html)` reports every edit.
 */
export default function RichTextEditor({ id, value, onChange, placeholder, autoFocus, onKeyDown, className = "" }) {
    const ref = useRef(null);
    const [active, setActive] = useState({});
    const [empty, setEmpty] = useState(true);

    useEffect(() => {
        const el = ref.current;
        el.innerHTML = sanitizeHtml(value);
        setEmpty(!el.textContent.trim());
        if (autoFocus) {
            el.focus();
            placeCaretAtEnd(el);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Toolbar buttons light up for the formatting under the caret.
    useEffect(() => {
        const onSelection = () => {
            if (!ref.current?.contains(document.getSelection()?.anchorNode)) return;
            const state = {};
            [...MARKS, ...LISTS].forEach((m) => { state[m.command] = document.queryCommandState(m.command); });
            setActive(state);
        };
        document.addEventListener("selectionchange", onSelection);
        return () => document.removeEventListener("selectionchange", onSelection);
    }, []);

    // Enter starts a new <p> (not a <div>), in every browser
    const onFocus = () => { document.execCommand("defaultParagraphSeparator", false, "p"); };

    const emit = () => {
        const el = ref.current;
        setEmpty(!el.textContent.trim() && !el.querySelector("li"));
        onChange(el.innerHTML);
    };

    const run = (command, arg = null) => {
        ref.current.focus();
        document.execCommand("styleWithCSS", false, true);
        document.execCommand(command, false, arg);
        emit();
    };

    const setColor = (color) => {
        if (color) { run("foreColor", color); return; }
        // Back to the default color, keeping bold etc.: color the selection with a marker, then
        // remove the marker so the text inherits the normal color again (in either theme).
        run("foreColor", DEFAULT_MARKER);
        ref.current.querySelectorAll("[style]").forEach((el) => {
            if (el.style.color === DEFAULT_MARKER_RGB) el.style.removeProperty("color");
            if (!el.getAttribute("style")) el.removeAttribute("style");
        });
        ref.current.querySelectorAll("font[color]").forEach((el) => {
            if (el.getAttribute("color").toLowerCase() === DEFAULT_MARKER) el.replaceWith(...el.childNodes);
        });
        emit();
    };

    const onPaste = (e) => {
        e.preventDefault();
        const html = e.clipboardData.getData("text/html");
        const text = e.clipboardData.getData("text/plain");
        document.execCommand("insertHTML", false, sanitizeHtml(html || text));
        emit();
    };

    // keep the editor's selection when a toolbar button is pressed
    const keepFocus = (e) => e.preventDefault();

    return (
        <div className={`ord-rte ${className}`}>
            <div className="ord-rte-toolbar" role="toolbar" aria-label="Text formatting" onMouseDown={keepFocus}>
                {MARKS.map((m) => (
                    <ToolButton key={m.command} {...m} active={active[m.command]} onClick={() => run(m.command)} />
                ))}
                <span className="ord-rte-sep" />
                {COLORS.map((c) => (
                    <button
                        key={c.label}
                        type="button"
                        className={`ord-rte-color${c.value ? "" : " is-default"}`}
                        style={c.value ? { background: c.value } : undefined}
                        onClick={() => setColor(c.value)}
                        title={c.label}
                        aria-label={c.label}
                    />
                ))}
                <ToolButton icon={Highlighter} label="Highlight" onClick={() => run("hiliteColor", HIGHLIGHT)} />
                <span className="ord-rte-sep" />
                {LISTS.map((m) => (
                    <ToolButton key={m.command} {...m} active={active[m.command]} onClick={() => run(m.command)} />
                ))}
                <span className="ord-rte-sep" />
                <ToolButton icon={RemoveFormatting} label="Clear formatting" onClick={() => { run("removeFormat"); run("hiliteColor", "transparent"); }} />
            </div>
            <div
                ref={ref}
                id={id}
                className={`ord-rte-content${empty ? " is-empty" : ""}`}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                data-placeholder={placeholder}
                onInput={emit}
                onFocus={onFocus}
                onPaste={onPaste}
                onKeyDown={onKeyDown}
            />
        </div>
    );
}

// Caret after the last character of the last line - inside the last list item or paragraph,
// not after the list, where typing would start a stray line outside it.
function placeCaretAtEnd(el) {
    let node = el;
    while (node.lastChild && !(node.lastChild.nodeType === 1 && node.lastChild.tagName === "BR")) node = node.lastChild;
    const range = document.createRange();
    if (node.nodeType === 3) range.setStart(node, node.length);
    else if (node.lastChild) range.setStartBefore(node.lastChild); // before a trailing <br>
    else range.setStart(node, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

function ToolButton({ icon: Icon, label, active, onClick }) {
    return (
        <button type="button" className={`ord-rte-btn${active ? " is-active" : ""}`} onClick={onClick} title={label} aria-label={label} aria-pressed={!!active}>
            <Icon size={15} />
        </button>
    );
}
