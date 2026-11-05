import moment from "moment";
import exportTableToExcel from "../../utils/exportTableToExcel";
import { esc, gridTable, openPrintWindow, printHtml, userName } from "../../utils/printBrand";
import { loadCompanyInfo } from "../../utils/appSettings";
import { htmlToText, sanitizeHtml } from "./richText";
import { formatDateTime, formatDay, formatTime } from "../../utils/dates";

// One order as a printed slip (receipt-style, 80 mm), and the orders list as a branded Excel sheet or a printed report
// (the same pattern the Sales Volume Rebate reports follow).

const stamp = formatDateTime;
const phoneOf = (o) => o.phone || o.clientPhone1 || o.clientPhone2 || "";
const clientOf = (o) => (o.clientName ? o.clientName.trim() : "Walk-in / unknown");
// this order's delivery address when it has one, else the client's
const addressOf = (o) => o.address?.trim() || o.clientAddress?.trim() || "";

const COLUMNS = [
    { Header: "Order #", accessor: "recID" },
    { Header: "Client", accessor: "client" },
    { Header: "Phone", accessor: "phone" },
    { Header: "Address", accessor: "address" },
    { Header: "Order", accessor: "orderText" },
    { Header: "Created At", accessor: "created" },
    { Header: "Status", accessor: "status" },
    { Header: "Completed At", accessor: "completed" },
];

const toRow = (o) => ({
    recID: String(o.recID),
    client: clientOf(o),
    phone: phoneOf(o),
    address: addressOf(o),
    orderText: htmlToText(o.orderText),
    created: stamp(o.cdStamp),
    status: o.status || "",
    completed: o.completedAt ? stamp(o.completedAt) : "",
});

const countLabel = (n) => `${n} ${n === 1 ? "order" : "orders"}`;

export function exportOrdersToExcel(orders, { filterLabel } = {}) {
    return exportTableToExcel(COLUMNS, orders.map(toRow), `Orders ${moment().format("YYYY-MM-DD")}`, "Orders", {
        title: "Orders Sheet",
        subtitle: [filterLabel, countLabel(orders.length)].filter(Boolean).join(" · "),
    });
}

// The rows printed follow the page's search and filter; the header only names the report.
export async function printOrdersReport(orders, { filterLabel } = {}) {
    const { name: companyName } = await loadCompanyInfo();
    const rows = orders.map(toRow);
    return openPrintWindow({
        title: "Orders Report",
        details: [filterLabel, countLabel(rows.length)].filter(Boolean).join(" · "),
        companyName,
        body: gridTable(COLUMNS.map((c) => ({ header: c.Header, key: c.accessor, num: c.accessor === "recID" })), rows, { emptyText: "No orders." }),
    });
}

// Sized for an 80 mm receipt printer; on A4 it prints as a narrow slip in the top left corner,
// like the Crystal Reports slips: the company name, when and by whom it was printed, then the order.
// The printer's paper (e.g. Star TSP143 "72mm x Receipt") sets the page: 72 mm printable on an 80 mm
// roll, cut after the last line. No @page size, so whatever paper the printer has is used as it is.
const SLIP_CSS = `
  @page { margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #000; font: 13px/1.45 "Segoe UI", system-ui, sans-serif; }
  .slip { width: 72mm; max-width: 100%; margin: 0; padding: 2mm 3mm 4mm; }
  .head { padding-bottom: 6px; margin-bottom: 6px; border-bottom: 3px double #000; font-size: 11px; }
  .company { font-size: 15px; font-weight: 700; text-align: center; line-height: 1.25; margin-bottom: 4px; overflow-wrap: anywhere; }
  .head-row { display: flex; gap: 4px; }
  .head-row b { flex: 0 0 auto; }
  .ref { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; padding-bottom: 6px; border-bottom: 1px dashed #000; }
  .client { padding: 8px 0; border-bottom: 1px dashed #000; }
  .name { font-size: 17px; font-weight: 700; line-height: 1.25; }
  .phone { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .address { margin-top: 4px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .order { padding: 8px 0; font-size: 14px; overflow-wrap: anywhere; }
  .order p, .order div { margin: 0 0 2px; }
  .order ul, .order ol { margin: 0 0 2px; padding: 0 18px; }
  .end { border-top: 1px dashed #000; }
  /* each line takes its own direction: Arabic lines read right to left, English ones left to right */
  .name, .address, .order p, .order div, .order li { unicode-bidi: plaintext; text-align: start; }
  @media screen { body { background: #f3f4f6; padding: 16px; } .slip { background: #fff; padding: 4mm; box-shadow: 0 1px 4px rgba(0,0,0,.15); } }
`;

// Each line reads in its own direction (dir="auto"), so an Arabic list item has its bullet on the right.
function withLineDirections(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    doc.body.querySelectorAll("p, div, li").forEach((el) => el.setAttribute("dir", "auto"));
    return doc.body.innerHTML;
}

/** A single order as a slip: client name, phone, address and the order, to go with the delivery. */
export async function printOrder(order) {
    const address = addressOf(order);
    const { name: companyName } = await loadCompanyInfo();
    const now = new Date();
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Order #${esc(order.recID)}</title><style>${SLIP_CSS}</style></head><body>
<div class="slip">
  <div class="head">
    ${companyName ? `<div class="company">${esc(companyName)}</div>` : ""}
    <div class="head-row"><b>Printing Date:</b><span>${esc(formatDay(now))} - ${esc(formatTime(now))}</span></div>
    <div class="head-row"><b>Printed by:</b><span>${esc(userName() || "-")}</span></div>
  </div>
  <div class="ref"><span>Order #${esc(order.recID)}</span><span>${esc(stamp(order.cdStamp))}</span></div>
  <div class="client">
    <div class="name">${esc(clientOf(order))}</div>
    ${phoneOf(order) ? `<div class="phone">${esc(phoneOf(order))}</div>` : ""}
    ${address ? `<div class="address">${esc(address)}</div>` : ""}
  </div>
  <div class="order">${withLineDirections(sanitizeHtml(order.orderText))}</div>
  <div class="end"></div>
</div>
</body></html>`;
    return printHtml(html);
}
