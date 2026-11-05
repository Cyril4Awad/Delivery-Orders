import { htmlToText, isBlankHtml, sanitizeHtml } from "./richText";

describe("sanitizeHtml", () => {
    it("keeps simple formatting and safe inline styles", () => {
        expect(sanitizeHtml('<b>2 kg</b> <i>tomatoes</i> <span style="color: rgb(220, 38, 38); background-color: #fde68a">urgent</span>'))
            .toBe('<b>2 kg</b> <i>tomatoes</i> <span style="color: rgb(220, 38, 38); background-color: rgb(253, 230, 138)">urgent</span>');
        expect(sanitizeHtml("<ul><li>bread</li><li>water</li></ul>")).toBe("<ul><li>bread</li><li>water</li></ul>");
    });

    it("removes scripts, event handlers, links and unsafe styles", () => {
        const out = sanitizeHtml('<img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">click</a>'
            + '<span onclick="x()" style="background-image: url(javascript:alert(4)); color: red">ok</span><iframe src="//evil"></iframe>');
        expect(out).toBe('click<span style="color: red">ok</span>');
        expect(out).not.toMatch(/script|onerror|onclick|javascript|iframe|img|url\(/i);
    });

    it("turns old plain-text orders into escaped HTML lines", () => {
        expect(sanitizeHtml("2 kg tomatoes\n1 <bread> & co")).toBe("2 kg tomatoes<br>1 &lt;bread&gt; &amp; co");
    });

    it("converts <font color> from older browsers", () => {
        expect(sanitizeHtml('<font color="#2563eb" face="Comic Sans">blue</font>')).toBe('<span style="color: rgb(37, 99, 235)">blue</span>');
    });
});

describe("htmlToText", () => {
    it("gives one line per paragraph, break or list item", () => {
        expect(htmlToText("<p><b>2 kg</b> tomatoes</p><p>1 bread<br>6 water</p><ul><li>milk</li></ul>"))
            .toBe("2 kg tomatoes\n1 bread\n6 water\n• milk");
    });

    it("keeps list markers: bullets, and numbers counted per list", () => {
        expect(htmlToText("<ul><li>eggs</li><li>milk</li></ul><ol><li>bread</li><li>water</li></ol>"))
            .toBe("• eggs\n• milk\n1. bread\n2. water");
    });

    it("leaves plain text alone", () => {
        expect(htmlToText("a\nb")).toBe("a\nb");
    });
});

describe("isBlankHtml", () => {
    it("treats an emptied editor as blank", () => {
        expect(isBlankHtml("<p><br></p>")).toBe(true);
        expect(isBlankHtml("<div>&nbsp;</div>")).toBe(true);
        expect(isBlankHtml("<b>x</b>")).toBe(false);
    });
});
