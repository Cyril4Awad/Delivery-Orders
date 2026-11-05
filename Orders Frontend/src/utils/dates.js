// Dates as the Orders screens, prints and exports show them: the day's name first,
// "Friday 23/10/2026" and "Friday 23/10/2026 04:25 PM". Day names are always English.

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n) => String(n).padStart(2, "0");

const toDate = (value) => {
    if (value == null || value === "") return null;
    // "YYYY-MM-DD" alone (date inputs) is a local day, not UTC midnight
    const d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T00:00:00`)
        : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
};

/** "04:25 PM" */
export const formatTime = (value) => {
    const d = toDate(value);
    if (!d) return "";
    const h = d.getHours();
    return `${pad(h % 12 || 12)}:${pad(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
};

/** "Friday 23/10/2026" */
export const formatDay = (value) => {
    const d = toDate(value);
    return d ? `${DAYS[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : "";
};

/** "Friday 23/10/2026 04:25 PM" */
export const formatDateTime = (value) => {
    const d = toDate(value);
    return d ? `${formatDay(d)} ${formatTime(d)}` : "";
};
