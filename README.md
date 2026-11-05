# Orders - deploying to a client

Two parts: **Orders Backend** (ASP.NET Core 8 API + SignalR, talks to the client's SuperStore SQL
Server) and **Orders Frontend** (React screens). Plus the **CallerID** Android app on the
phones that receive the calls.

## What's in this folder

| Folder | What |
|---|---|
| `Orders Frontend` | React screens (source) |
| `Orders Backend` | API + SignalR (`Orders.sln`), `SQL Scripts` |
| `Installers` | `dotnet-hosting-8.0.32-win.exe` (.NET 8 Hosting Bundle for IIS / the server), `CallerID.apk` (phone app) |

To build you also need, on the build PC only: the **.NET 8 SDK** and **Node.js** (LTS).
`node_modules`, `bin`, `obj`, `build` and `publish` are not included - building recreates them.

Recommended layout: the backend runs on one always-on machine with a **fixed IP**, and serves the
screens itself (frontend copied into its `wwwroot`). Users open `http://SERVER:5213` in a browser;
phones post calls to `http://SERVER:5213/api/incoming-call`.

---

## 1. Database (client's SuperStore database)

Needs the existing SuperStore tables: `tbl_Clients`, `com_company`, `COm_Logo`.

Run **`Orders Backend/SQL Scripts/Create - Orders Tables.sql`** - for a new client and for an upgrade alike.
It creates the missing tables (`tbl_OrderStatus` with its four statuses, `tbl_Orders`, `tbl_OrderStatusLog`,
`tbl_OrderCalls`) and missing columns, and never drops a table or deletes data, so it is safe to run again.
Back up the database first anyway.

Use a dedicated SQL login for the app (read/write on `tbl_Orders`, `tbl_OrderCalls`, `tbl_OrderStatus`, `tbl_OrderStatusLog`, `tbl_Clients`;
read on `com_company`, `COm_Logo`), not `sa`.

## 2. Backend - `Orders Backend/Main/appsettings.json`

**Change for every client:**

| Setting | What to put |
|---|---|
| `ConnectionStrings:Constr` | The client's SQL Server, database and the app's SQL login - **encrypted** with the encryptor (same as Sales Volume Rebate). A plain `Data Source=SERVER;Initial Catalog=DATABASE;User ID=USER;Password=PASSWORD
| `Urls` | Address/port when `Main.exe` runs on its own. Ignored under IIS (the site's binding sets the port) |
| `PathBase` | The path in the address: `/Orders` -> `http://SERVER:8888/Orders/` (the bare address redirects there). Empty = served at the root. `appsettings.Development.json` sets it empty for Visual Studio |
| `Orders:ClientLoc` | The client's location code. New callers are created there, and only this location's screens ring |
| `Orders:ClientType`, `ClientClass`, `ClientCurrency`, `ClientUsePrice`, `ClientZeroSLPrice` | Defaults for clients created from a call - match how the client's `tbl_Clients` is filled |
| `Orders:CountryCode` | Dialing code removed when matching callers to client phones (`961` Lebanon) |
| `IncomingCall:ApiKey` | A long random key, different for each client |
| `IncomingCall:RequireApiKey` | `true` once the phone app sends the key. **`false` today** because CallerID 2.0 can't send one |
| `Cors:Origins` | Only if the screens are hosted on another address than the API: that address, e.g. `http://SERVER:3010`. Not needed when the backend serves the screens |

**Keep as is:** `IncomingCall:RingSeconds` (seconds the screens ring before a call counts as
missed; 25 now), `Orders:UserStamp`, `Logging`, `AllowedHosts`.

## 3. Build and publish

```
# screens
cd "Orders Frontend"
npm ci
npm run build                      # -> Orders Frontend\build

# API
cd "Orders Backend"
dotnet publish Main/Main.csproj -c Release -o publish
#   (or Visual Studio: Publish > FolderProfile -> Orders Backend\publish)

# serve the screens from the API
copy everything in "Orders Frontend\build" into "Orders Backend\publish\wwwroot"
```

Then in `publish\wwwroot\config.js` set:

```js
window.__APP_CONFIG__ = { API_BASE: "/Orders/api" };
```

That is `PathBase` (section 2) + `/api`. With `PathBase` empty, use `"/api"`.
(If the screens are hosted separately instead, put the full API address there, e.g.
`"http://0.0.0.0:5213/api"`, and add the screens' address to `Cors:Origins`.)
`config.js` can be edited on the server at any time - no rebuild.

## 4. Client's server (IIS)

1. Run `Installers/dotnet-hosting-8.0.32-win.exe` as administrator (the .NET 8 Hosting Bundle -
   runtime + IIS module), then `iisreset`.
2. Copy **the contents** of `publish` to e.g. `C:\inetpub\Orders` - `web.config` and `Main.dll`
   must sit directly in that folder (not in a `publish` subfolder: that gives HTTP 403.14).
   Not inside `C:\inetpub\wwwroot` (that is Default Web Site's folder).
3. IIS Manager -> **Application Pools -> Add**: `Orders`, **No Managed Code**.
   One pool per .NET app - don't share it.
4. **Sites -> Add Website**: path `C:\inetpub\Orders`, pool `Orders`, port e.g. `8888`.
   With `PathBase` `/Orders` users open `http://SERVER:8888/Orders/`.
5. The port is only set in the IIS binding (the `Urls` setting and `launchSettings.json` are ignored
   under IIS). Open it in the firewall for the local network.
6. Give the machine a **fixed IP** (static, or a DHCP reservation in the router).
7. Check: the address shows the Orders screen with **Live**, and `<address>/api/Orders` returns JSON.

Without IIS, `Main.exe` can also run as a Windows service (it then listens on `Urls`, default port 5213):
`sc create Orders binPath= "C:\Orders\Main.exe" start= auto`.

`launchSettings.json` and Swagger are for development only - they're not used on the client's server.

## 5. Phones (CallerID app)

On each phone that receives the client's calls:

1. Install `Installers/CallerID.apk`.
2. **Delivery settings**: API only, URL = the app's address + `/api/incoming-call`, e.g.
   `http://SERVER-IP:8888/Orders/api/incoming-call`. Save.
3. Turn on **Enable incoming-call delivery**.
4. **Select caller ID app** -> CallerID (Android "Caller ID & spam" role).
5. Optional: WhatsApp call detection + notification access.
6. The phone must be on a Wi-Fi that can reach the server. **Send test** -> the call pops up on the screens.

What the app sends: `{"mobileNumber":"03553532","callType":1,"callTypeName":"INCOMING"}` when the phone rings
(the screens ring), then `callType 2` / `ONGOING` when it is picked up on the phone (the screens stop
ringing, the call is **Answered** and its order is still to take). A call with no `ONGOING` within
`IncomingCall:RingSeconds` is stored as **Missed**; an `ONGOING` that comes late turns it back to Answered.

## 6. Before go-live

- [ ] The screens have **no login**: anyone who can open the address can see and edit orders and
      clients. Keep the server on the client's local network only - never expose it to the internet.
- [ ] `RequireApiKey` is `false` until the phone app sends `X-Api-Key`; until then anyone on the
      network can make a fake call pop up (no data is exposed).
- [ ] The SQL password sits in `appsettings.json` - restrict access to that folder.
- [ ] The name under the logo and on reports comes from `com_company`; the Excel logo from `COm_Logo`.
