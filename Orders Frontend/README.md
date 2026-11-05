# Orders - screens

React (create-react-app) front end for phone orders and caller ID. One page: `src/Forms/Orders/OrdersPage.jsx`.

- `npm start` - dev server on http://localhost:3010 (port in `.env`), talks to the backend at `public/config.js` -> `API_BASE`.
- `npm test` - unit tests (rich-text cleaning).
- `npm run build` - production build in `build/`.

Layout: `src/Forms/Orders` (the screen), `src/ui` (dialogs, picker, toasts, table helpers),
`src/theme` (design tokens, light/dark), `src/utils` (Excel export and print branding).

Building, publishing and deploying: see `../README.md`.
