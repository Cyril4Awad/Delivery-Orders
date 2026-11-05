// Orders API (Orders Backend / Main), set per install in public/config.js (window.__APP_CONFIG__.API_BASE):
//   "api"                       next to the page - works at the site root or under an IIS application
//                               (http://server:8888/Orders/ -> http://server:8888/Orders/api)
//   "/api"                      the root of the site the page came from
//   "http://server:5213/api"    a backend at another address (needs Cors:Origins on the backend)
export const getApiBase = () => {
    const base = window.__APP_CONFIG__?.API_BASE ?? "http://localhost:5213/api";
    return new URL(base, document.baseURI).href.replace(/\/+$/, "");
};
