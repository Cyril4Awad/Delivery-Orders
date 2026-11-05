// The order text is stored as a small subset of HTML (from RichTextEditor). Older orders are plain
// text. Everything shown as HTML goes through sanitizeHtml first: only simple formatting survives.

const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "BR", "P", "DIV", "SPAN", "UL", "OL", "LI"]);
// dropped together with their content; any other unknown tag is unwrapped (its text is kept)
const DROPPED_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "NOSCRIPT", "SVG", "MATH", "HEAD", "TITLE", "META", "LINK"]);
const ALLOWED_STYLES = ["color", "background-color", "font-weight", "font-style", "text-decoration", "text-decoration-line", "text-align"];
// colors (#hex, rgb()/rgba(), names) and plain keywords only: no url(), expression(), etc.
const SAFE_STYLE_VALUE = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\)|[a-z-]+(\s+[a-z-]+)*)$/i;

// Saved by the editor (it only writes these tags); anything else is an older plain-text order,
// even when it has a "<" in it ("1 <large> pizza").
export const isHtml = (value) => /<\/?(b|strong|i|em|u|s|strike|br|p|div|span|ul|ol|li|font)\b[^>]*>/i.test(value ?? "");

const escapeText = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cleanStyle(style) {
    const kept = [];
    ALLOWED_STYLES.forEach((prop) => {
        const value = style.getPropertyValue(prop).trim();
        if (value && SAFE_STYLE_VALUE.test(value)) kept.push(`${prop}: ${value}`);
    });
    return kept.join("; ");
}

function cleanNode(node, doc) {
    [...node.childNodes].forEach((child) => {
        if (child.nodeType === 3) return; // text
        if (child.nodeType !== 1) { child.remove(); return; } // comments etc.
        const tag = child.tagName.toUpperCase();
        if (DROPPED_TAGS.has(tag)) { child.remove(); return; }
        cleanNode(child, doc);
        if (!ALLOWED_TAGS.has(tag)) {
            // <font color> (older browsers' execCommand) becomes a colored span; anything else is unwrapped
            if (tag === "FONT" && child.getAttribute("color")) {
                const span = doc.createElement("span");
                span.style.color = child.getAttribute("color");
                while (child.firstChild) span.appendChild(child.firstChild);
                child.replaceWith(span);
                const style = cleanStyle(span.style);
                if (style) span.setAttribute("style", style); else span.removeAttribute("style");
                return;
            }
            child.replaceWith(...child.childNodes);
            return;
        }
        const style = child.getAttribute("style") ? cleanStyle(child.style) : "";
        [...child.attributes].forEach((a) => child.removeAttribute(a.name));
        if (style) child.setAttribute("style", style);
    });
}

/** Safe HTML from whatever came in (editor, paste, database); plain text is converted. */
export function sanitizeHtml(value) {
    if (!value) return "";
    if (!isHtml(value)) return escapeText(value).replace(/\r?\n/g, "<br>");
    // DOMParser documents are inert: nothing in them runs or loads
    const doc = new DOMParser().parseFromString(`<body>${value}</body>`, "text/html");
    cleanNode(doc.body, doc);
    return doc.body.innerHTML;
}

/** Plain text, one line per paragraph / line break / list item; list items keep their "•" / "1." marker. */
export function htmlToText(value) {
    if (!value) return "";
    if (!isHtml(value)) return value;
    const doc = new DOMParser().parseFromString(`<body>${value}</body>`, "text/html");
    doc.querySelectorAll("li").forEach((li) => {
        const list = li.parentElement;
        const n = list?.tagName === "OL" ? [...list.children].filter((c) => c.tagName === "LI").indexOf(li) + 1 : 0;
        li.prepend(n ? `${n}. ` : "• ");
    });
    doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    doc.querySelectorAll("p, div, li").forEach((block) => block.append("\n"));
    return (doc.body.textContent ?? "").replace(/ /g, " ").replace(/\n{2,}/g, "\n").trim();
}

/** Nothing but whitespace (e.g. an editor left with "<p><br></p>"). */
export const isBlankHtml = (value) => !htmlToText(value).trim();
