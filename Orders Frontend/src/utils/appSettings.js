import { getApiBase } from "../globals";

/* ---------- Company info (com_company), for report headers ---------- */

const COMPANY_KEY = "companyInfo";
let companyPromise = null;

/**
 * { code, name, abbreviation, address, phone } read once per session (GET /api/Company/info)
 * and kept in sessionStorage under "companyInfo", where the Excel exports read the name.
 */
export function loadCompanyInfo() {
    try {
        const cached = JSON.parse(sessionStorage.getItem(COMPANY_KEY) ?? "null");
        if (cached) return Promise.resolve(cached);
    } catch {
        // ignore
    }
    companyPromise ??= fetch(`${getApiBase()}/Company/info`)
        .then((r) => (r.ok ? r.json() : null))
        .then((row) => {
            const info = {
                code: row?.comp_Code ?? "",
                name: (row?.comp_Name ?? "").trim(),
                abbreviation: (row?.comp_AbrName ?? "").trim(),
                address: (row?.comp_Addr ?? "").trim(),
                phone: (row?.comp_Phone1 ?? "").trim(),
            };
            try { sessionStorage.setItem(COMPANY_KEY, JSON.stringify(info)); } catch { /* ignore */ }
            return info;
        })
        .catch(() => {
            companyPromise = null;
            return { code: "", name: "", abbreviation: "", address: "", phone: "" };
        });
    return companyPromise;
}

/* ---------- Company logo (COm_Logo.L_Img), for the Excel exports ---------- */

let logoPromise = null;

/**
 * The logo as a PNG data URL and its pixel size, or null. The database stores a bitmap,
 * which Excel files can't embed, so the browser converts it to PNG once per session.
 */
export function loadCompanyLogo() {
    logoPromise ??= fetch(`${getApiBase()}/Company/logo`)
        .then((r) => (r.status === 204 || !r.ok ? null : r.blob()))
        .then((blob) => (!blob?.size ? null : toPng(blob)))
        .catch(() => { logoPromise = null; return null; });
    return logoPromise;
}

function toPng(blob) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext("2d").drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            resolve({ dataUrl: canvas.toDataURL("image/png"), width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
    });
}
