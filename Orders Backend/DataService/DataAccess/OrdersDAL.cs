using Dapper;
using DataService.Models.DTOs;
using DataService.Others;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using System.Data;

namespace DataService.DataAccess
{
    public class OrdersDAL
    {
        private readonly IConfiguration configuration;
        private readonly OrdersOptions options;

        public OrdersDAL(IConfiguration configuration, IOptions<OrdersOptions> options)
        {
            this.configuration = configuration;
            this.options = options.Value;
        }

        private SqlConnection Connection() => new SqlConnection(configuration.GetConnectionString("Constr"));

        private const string OrderSelect = @"
            SELECT
                o.Ord_RecID      AS RecID,
                o.Ord_ClientLoc  AS ClientLoc,
                o.Ord_ClientID   AS ClientID,
                c.Clt_Nbr        AS ClientNbr,
                c.Clt_Name       AS ClientName,
                c.Clt_Phone1     AS ClientPhone1,
                c.Clt_Phone2     AS ClientPhone2,
                c.Clt_Address    AS ClientAddress,
                o.Ord_Phone      AS Phone,
                o.Ord_Address    AS Address,
                o.Ord_OrderText  AS OrderText,
                o.Ord_Status     AS Status,
                o.Ord_CompletedAt AS CompletedAt,
                o.Ord_CDStamp    AS CDStamp,
                o.Ord_CUStamp    AS CUStamp,
                o.Ord_MDStamp    AS MDStamp
            FROM dbo.tbl_Orders o
            LEFT JOIN dbo.tbl_Clients c ON c.Clt_Loc = o.Ord_ClientLoc AND c.Clt_RecId = o.Ord_ClientID";

        public async Task<List<OrderDto>> GetOrders()
        {
            using var cn = Connection();
            var rows = await cn.QueryAsync<OrderDto>(OrderSelect + " ORDER BY o.Ord_RecID DESC;");
            return rows.ToList();
        }

        /// <summary>The client's latest orders, newest first, leaving out `exceptId` (the order being edited).</summary>
        public async Task<List<OrderDto>> GetClientOrders(string clientLoc, decimal clientId, int take, decimal? exceptId)
        {
            using var cn = Connection();
            var rows = await cn.QueryAsync<OrderDto>(
                OrderSelect.Replace("SELECT", "SELECT TOP (@take)") + @"
                WHERE o.Ord_ClientLoc = @clientLoc AND o.Ord_ClientID = @clientId
                  AND (@exceptId IS NULL OR o.Ord_RecID <> @exceptId)
                ORDER BY o.Ord_RecID DESC;", new { clientLoc, clientId, take, exceptId });
            return rows.ToList();
        }

        public async Task<OrderDto?> GetOrderById(decimal id)
        {
            using var cn = Connection();
            return await cn.QueryFirstOrDefaultAsync<OrderDto>(OrderSelect + " WHERE o.Ord_RecID = @id;", new { id });
        }

        /// <summary>
        /// Saves the order; when order.NewClient is set the client is created first in tbl_Clients
        /// (location from appsettings "Orders:ClientLoc"), in the same transaction.
        /// </summary>
        public async Task<OrderDto> SaveOrder(SaveOrderRequest order, string? user)
        {
            user = Stamp(user);
            decimal id;
            using (var cn = Connection())
            {
                await cn.OpenAsync();
                using var tx = cn.BeginTransaction(IsolationLevel.ReadCommitted);

                if (order.NewClient != null)
                {
                    var client = await CreateClient(cn, tx, order.NewClient, user);
                    order.ClientLoc = client.Loc;
                    order.ClientID = client.RecID;
                }

                var args = new
                {
                    id = order.RecID ?? 0,
                    order.ClientLoc,
                    order.ClientID,
                    Phone = NullIfWhite(order.Phone),
                    Address = NullIfWhite(order.Address),
                    OrderText = order.OrderText.Trim(),
                    order.Status,
                    User = user,
                };

                if (order.RecID is null or 0)
                {
                    id = await cn.ExecuteScalarAsync<decimal>(@"
                        INSERT INTO dbo.tbl_Orders (Ord_ClientLoc, Ord_ClientID, Ord_Phone, Ord_Address, Ord_OrderText, Ord_Status,
                                                    Ord_CDStamp, Ord_CUStamp, Ord_MDStamp, Ord_MUStamp)
                        OUTPUT INSERTED.Ord_RecID
                        VALUES (@ClientLoc, @ClientID, @Phone, @Address, @OrderText, @Status,
                                GETDATE(), @User, GETDATE(), @User);",
                        new { args.ClientLoc, args.ClientID, args.Phone, args.Address, args.OrderText, Status = order.Status ?? OrderStatus.UnderProcess, User = user }, tx);
                    await ApplyStatus(cn, tx, id, null, order.Status ?? OrderStatus.UnderProcess, user);
                }
                else
                {
                    id = order.RecID.Value;
                    var old = await CurrentStatus(cn, tx, id);
                    await cn.ExecuteAsync(@"
                        UPDATE dbo.tbl_Orders SET
                            Ord_ClientLoc  = @ClientLoc,
                            Ord_ClientID   = @ClientID,
                            Ord_Phone      = @Phone,
                            Ord_Address    = @Address,
                            Ord_OrderText  = @OrderText,
                            Ord_MDStamp    = GETDATE(),
                            Ord_MUStamp    = @User
                        WHERE Ord_RecID = @id;", args, tx);
                    await ApplyStatus(cn, tx, id, old, order.Status ?? old, user);
                }

                // the call this order was taken for is no longer missed / waiting
                if (order.CallID is > 0)
                {
                    await cn.ExecuteAsync(@"
                        UPDATE dbo.tbl_OrderCalls SET Cal_OrderID = @id, Cal_Status = 'Ordered', Cal_MDStamp = GETDATE(), Cal_MUStamp = @User
                        WHERE Cal_RecID = @CallID AND Cal_OrderID IS NULL;", new { id, order.CallID, User = user }, tx);
                }

                tx.Commit();
            }
            return (await GetOrderById(id))!;
        }

        // Clt_RecId is unique across locations, so the next id is global; Clt_Nbr takes the same
        // value, or the next free number when that one is already used by another client.
        private async Task<ClientLookupDto> CreateClient(SqlConnection cn, SqlTransaction tx, NewClientRequest c, string user)
        {
            return await cn.QuerySingleAsync<ClientLookupDto>(@"
                DECLARE @RecId numeric(18,0) = (SELECT ISNULL(MAX(Clt_RecId), 0) + 1 FROM dbo.tbl_Clients WITH (UPDLOCK, HOLDLOCK));
                DECLARE @Nbr bigint = @RecId;
                WHILE EXISTS (SELECT 1 FROM dbo.tbl_Clients WHERE Clt_Nbr = CAST(@Nbr AS varchar(10))) SET @Nbr += 1;

                INSERT INTO dbo.tbl_Clients
                    (Clt_Loc, Clt_RecId, Clt_Nbr, Clt_Name, Clt_Type, Clt_Class, Clt_Active, Clt_ZeroSLPrice, Clt_UsePrice,
                     Clt_Curr, Clt_Phone1, Clt_Address, Clt_Dstmp, Clt_Ustmp)
                OUTPUT INSERTED.Clt_Loc AS Loc, INSERTED.Clt_RecId AS RecID, INSERTED.Clt_Nbr AS Nbr, INSERTED.Clt_Name AS Name,
                       INSERTED.Clt_Phone1 AS Phone1, INSERTED.Clt_Phone2 AS Phone2, INSERTED.Clt_Address AS Address
                VALUES
                    (@Loc, @RecId, CAST(@Nbr AS varchar(10)), @Name, @Type, @Class, 'Y', @ZeroSLPrice, @UsePrice,
                     @Curr, @Phone, @Address, GETDATE(), @User);",
                new
                {
                    Loc = options.ClientLoc,
                    Name = c.Name.Trim(),
                    Phone = c.Phone.Trim(),
                    Address = NullIfWhite(c.Address),
                    Type = options.ClientType,
                    Class = options.ClientClass,
                    Curr = options.ClientCurrency,
                    UsePrice = options.ClientUsePrice,
                    ZeroSLPrice = options.ClientZeroSLPrice,
                    User = user,
                }, tx);
        }

        /// <summary>Sets the status (already cleaned up by the engine).</summary>
        public async Task SetStatus(decimal id, string status, string? user)
        {
            user = Stamp(user);
            using var cn = Connection();
            await cn.OpenAsync();
            using var tx = cn.BeginTransaction(IsolationLevel.ReadCommitted);
            var old = await CurrentStatus(cn, tx, id);
            await ApplyStatus(cn, tx, id, old, status, user);
            tx.Commit();
        }

        // The order's status, locked until the transaction ends so two screens don't log over each other.
        private static async Task<string> CurrentStatus(SqlConnection cn, SqlTransaction tx, decimal id) =>
            await cn.ExecuteScalarAsync<string?>(
                "SELECT Ord_Status FROM dbo.tbl_Orders WITH (UPDLOCK, ROWLOCK) WHERE Ord_RecID = @id;", new { id }, tx)
            ?? throw new NotFoundException($"Order {id} not found.");

        /// <summary>
        /// A new status (oldStatus null: the order was just created): stored with the modified stamps,
        /// logged in tbl_OrderStatusLog, and added to tbl_OrderStatus when it isn't listed yet.
        /// Ord_CompletedAt is set when the order becomes Completed and cleared when it stops being Completed.
        /// The same status again changes nothing.
        /// </summary>
        private static async Task ApplyStatus(SqlConnection cn, SqlTransaction tx, decimal id, string? oldStatus, string status, string user)
        {
            if (oldStatus != null && string.Equals(oldStatus, status, StringComparison.Ordinal)) return;
            await cn.ExecuteAsync(@"
                UPDATE dbo.tbl_Orders SET
                    Ord_Status      = @status,
                    Ord_CompletedAt = CASE WHEN @status = @completed THEN GETDATE() END,
                    Ord_MDStamp     = GETDATE(),
                    Ord_MUStamp     = @user
                WHERE Ord_RecID = @id;

                INSERT INTO dbo.tbl_OrderStatusLog (Osl_OrderID, Osl_Status, Osl_Date, Osl_CDStamp, Osl_CUStamp)
                VALUES (@id, @status, GETDATE(), GETDATE(), @user);

                IF NOT EXISTS (SELECT 1 FROM dbo.tbl_OrderStatus WITH (UPDLOCK, HOLDLOCK) WHERE Sts_Name = @status)
                    INSERT INTO dbo.tbl_OrderStatus (Sts_Name, Sts_SortOrder, Sts_CDStamp, Sts_CUStamp)
                    SELECT @status, ISNULL(MAX(Sts_SortOrder), 0) + 10, GETDATE(), @user FROM dbo.tbl_OrderStatus;",
                new { id, status, user, completed = OrderStatus.Completed }, tx);
        }

        /// <summary>The statuses the screens offer (tbl_OrderStatus), in their order.</summary>
        public async Task<List<OrderStatusDto>> GetStatuses()
        {
            using var cn = Connection();
            var rows = await cn.QueryAsync<OrderStatusDto>(@"
                SELECT Sts_RecID AS RecID, Sts_Name AS Name, Sts_SortOrder AS SortOrder
                FROM dbo.tbl_OrderStatus
                ORDER BY Sts_SortOrder, Sts_RecID;");
            return rows.ToList();
        }

        /// <summary>Every status the order had, oldest first.</summary>
        public async Task<List<OrderStatusLogDto>> GetStatusLog(decimal orderId)
        {
            using var cn = Connection();
            var rows = await cn.QueryAsync<OrderStatusLogDto>(@"
                SELECT Osl_RecID AS RecID, Osl_OrderID AS OrderID, Osl_Status AS Status, Osl_Date AS Date, Osl_CUStamp AS [User]
                FROM dbo.tbl_OrderStatusLog
                WHERE Osl_OrderID = @orderId
                ORDER BY Osl_RecID;", new { orderId });
            return rows.ToList();
        }

        private const string ClientSelect = @"
            SELECT Clt_Loc AS Loc, Clt_RecId AS RecID, Clt_Nbr AS Nbr, Clt_Name AS Name,
                   Clt_Phone1 AS Phone1, Clt_Phone2 AS Phone2, Clt_Address AS Address
            FROM dbo.tbl_Clients";

        private const string ClientSearchWhere = @"
                WHERE ISNULL(Clt_Active, 'Y') = 'Y'
                  AND (@search IS NULL
                       OR Clt_Name   LIKE '%' + @search + '%'
                       OR Clt_Nbr    LIKE @search + '%'
                       OR Clt_Phone1 LIKE '%' + @search + '%'
                       OR Clt_Phone2 LIKE '%' + @search + '%')";

        /// <summary>One page of active clients matching the search (name, code or phone), by name.</summary>
        public async Task<PagedResult<ClientLookupDto>> SearchClients(string? search, int page, int pageSize)
        {
            using var cn = Connection();
            var args = new { search = NullIfWhite(search), skip = (page - 1) * pageSize, take = pageSize };
            using var multi = await cn.QueryMultipleAsync(
                "SELECT COUNT(*) FROM dbo.tbl_Clients" + ClientSearchWhere + ";" +
                ClientSelect + ClientSearchWhere + @"
                ORDER BY Clt_Name, Clt_RecId
                OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY;", args);
            var total = await multi.ReadSingleAsync<int>();
            var items = (await multi.ReadAsync<ClientLookupDto>()).ToList();
            return new PagedResult<ClientLookupDto> { Items = items, Total = total };
        }

        public async Task<List<ClientLookupDto>> GetClientsWithPhones()
        {
            using var cn = Connection();
            var rows = await cn.QueryAsync<ClientLookupDto>(ClientSelect + @"
                WHERE ISNULL(Clt_Phone1, '') <> '' OR ISNULL(Clt_Phone2, '') <> '';");
            return rows.ToList();
        }

        public async Task<CompanyInfoDto?> GetCompanyInfo()
        {
            using var cn = Connection();
            return await cn.QueryFirstOrDefaultAsync<CompanyInfoDto>(@"
                SELECT TOP 1 Comp_Code, Comp_Name, Comp_AbrName, Comp_Addr, Comp_Phone1
                FROM com_company
                ORDER BY Comp_Code");
        }

        /// <summary>The company logo (COm_Logo.L_Img) as stored, usually a bitmap; null when there is none.</summary>
        public async Task<byte[]?> GetLogo()
        {
            using var cn = Connection();
            return await cn.ExecuteScalarAsync<byte[]?>(@"
                SELECT TOP 1 L_Img FROM COm_Logo
                WHERE L_Img IS NOT NULL
                ORDER BY CASE WHEN L_Comp = (SELECT TOP 1 Comp_Code FROM com_company ORDER BY Comp_Code) THEN 0 ELSE 1 END, L_Comp");
        }

        // ---------- Call log (tbl_OrderCalls) ----------

        /// <summary>Logs a call the caller-id provider reported (Ringing, or Answered when it came in already picked up); returns its id.</summary>
        public async Task<decimal> LogCall(IncomingCallEvent call)
        {
            var single = call.Clients.Count == 1 ? call.Clients[0] : null;
            using var cn = Connection();
            return await cn.ExecuteScalarAsync<decimal>(@"
                INSERT INTO dbo.tbl_OrderCalls (Cal_Loc, Cal_Phone, Cal_Match, Cal_MatchCount, Cal_ClientLoc, Cal_ClientID, Cal_Status, Cal_CDStamp)
                OUTPUT INSERTED.Cal_RecID
                VALUES (@Loc, @Phone, @Match, @Count, @ClientLoc, @ClientID, @Status, GETDATE());",
                new
                {
                    Loc = call.Location,
                    call.Phone,
                    call.Match,
                    Count = call.Clients.Count,
                    ClientLoc = single?.Loc,
                    ClientID = single?.RecID,
                    Status = call.Answered ? "Answered" : "Ringing",
                });
        }

        /// <summary>
        /// The phone app says the call was picked up (ONGOING): the latest Ringing (or already Missed - picked
        /// up late) call from that number in the last minutes becomes Answered. Returns its id; also the id of
        /// one already Answered (the app sent ONGOING twice); null when there is no such call.
        /// </summary>
        public async Task<decimal?> MarkAnsweredOnPhone(string location, string phone, int withinMinutes)
        {
            using var cn = Connection();
            var args = new { location, phone, withinMinutes };
            var id = await cn.ExecuteScalarAsync<decimal?>(@"
                WITH latest AS (
                    SELECT TOP 1 * FROM dbo.tbl_OrderCalls
                    WHERE Cal_Loc = @location AND Cal_Phone = @phone AND Cal_OrderID IS NULL
                      AND Cal_Status IN ('Ringing', 'Missed')
                      AND Cal_CDStamp >= DATEADD(MINUTE, -@withinMinutes, GETDATE())
                    ORDER BY Cal_RecID DESC)
                UPDATE latest SET Cal_Status = 'Answered', Cal_MDStamp = GETDATE(), Cal_MUStamp = 'APP'
                OUTPUT INSERTED.Cal_RecID;", args);
            return id ?? await cn.ExecuteScalarAsync<decimal?>(@"
                SELECT TOP 1 Cal_RecID FROM dbo.tbl_OrderCalls
                WHERE Cal_Loc = @location AND Cal_Phone = @phone AND Cal_Status = 'Answered'
                  AND Cal_CDStamp >= DATEADD(MINUTE, -@withinMinutes, GETDATE())
                ORDER BY Cal_RecID DESC;", args);
        }

        /// <summary>
        /// Claims a call's order for one screen (connection): true for the first screen, or the one that
        /// already has it; false when another screen was first. A ringing call, or one picked up on the
        /// phone that no screen has yet, can be claimed. A call that isn't logged is free to take.
        /// </summary>
        public async Task<bool> TakeCall(decimal id, string connectionId)
        {
            using var cn = Connection();
            var affected = await cn.ExecuteAsync(@"
                UPDATE dbo.tbl_OrderCalls SET Cal_Status = 'Answered', Cal_TakenBy = @connectionId, Cal_TakenAt = ISNULL(Cal_TakenAt, GETDATE())
                WHERE Cal_RecID = @id
                  AND ((Cal_Status IN ('Ringing', 'Answered') AND Cal_TakenBy IS NULL) OR Cal_TakenBy = @connectionId);", new { id, connectionId });
            if (affected > 0) return true;
            return !await cn.ExecuteScalarAsync<bool>("SELECT CAST(COUNT(*) AS bit) FROM dbo.tbl_OrderCalls WHERE Cal_RecID = @id;", new { id });
        }

        /// <summary>
        /// Stores Missed on the calls nobody took within the ring time (all locations); returns the
        /// locations that had some, so their screens can refresh. Run every few seconds (MissedCallsService).
        /// </summary>
        public async Task<List<string>> MarkMissedCalls(int ringSeconds)
        {
            using var cn = Connection();
            var locations = await cn.QueryAsync<string>(@"
                UPDATE dbo.tbl_OrderCalls SET Cal_Status = 'Missed', Cal_MDStamp = GETDATE()
                OUTPUT INSERTED.Cal_Loc
                WHERE Cal_Status = 'Ringing' AND Cal_OrderID IS NULL
                  AND Cal_CDStamp < DATEADD(SECOND, -@ringSeconds, GETDATE());", new { ringSeconds });
            return locations.Distinct().ToList();
        }

        /// <summary>Dealt with without an order (e.g. called back, wrong number): no longer missed.</summary>
        public async Task MarkCallHandled(decimal id, string? user)
        {
            using var cn = Connection();
            var affected = await cn.ExecuteAsync(@"
                UPDATE dbo.tbl_OrderCalls SET Cal_Status = 'Handled', Cal_MDStamp = GETDATE(), Cal_MUStamp = @user
                WHERE Cal_RecID = @id;", new { id, user = Stamp(user) });
            if (affected == 0) throw new NotFoundException($"Call {id} not found.");
        }

        // Stored status (Ringing | Answered | Missed | Handled | Ordered). An order always wins, and a call
        // still Ringing past the ring time already reads Missed before MissedCallsService stores it.
        private static string CallSelect(string top = "") => $@"
            SELECT {top}
                k.Cal_RecID      AS RecID,
                k.Cal_Phone      AS Phone,
                k.Cal_Match      AS Match,
                k.Cal_MatchCount AS MatchCount,
                ISNULL(oc.Clt_Name, mc.Clt_Name) AS ClientName,
                CASE
                    WHEN k.Cal_OrderID IS NOT NULL THEN 'Ordered'
                    WHEN k.Cal_Status <> 'Ringing' THEN k.Cal_Status
                    WHEN DATEDIFF(SECOND, k.Cal_CDStamp, GETDATE()) > @ringSeconds THEN 'Missed'
                    ELSE 'Ringing'
                END              AS Status,
                k.Cal_OrderID    AS OrderID,
                k.Cal_CDStamp    AS ReceivedAt,
                k.Cal_TakenAt    AS TakenAt
            FROM dbo.tbl_OrderCalls k
            LEFT JOIN dbo.tbl_Orders o   ON o.Ord_RecID = k.Cal_OrderID
            LEFT JOIN dbo.tbl_Clients oc ON oc.Clt_Loc = o.Ord_ClientLoc AND oc.Clt_RecId = o.Ord_ClientID
            LEFT JOIN dbo.tbl_Clients mc ON mc.Clt_Loc = k.Cal_ClientLoc AND mc.Clt_RecId = k.Cal_ClientID";

        /// <summary>
        /// The location's latest calls, newest first. `search` matches the number (digits typed in any
        /// spacing) or the client's name; `from` / `to` are days, both included.
        /// </summary>
        public async Task<List<CallLogDto>> GetCalls(string location, int ringSeconds, int take, string? search = null, DateTime? from = null, DateTime? to = null)
        {
            search = NullIfWhite(search);
            var digits = search == null ? null : new string(search.Where(char.IsDigit).ToArray());
            using var cn = Connection();
            var rows = await cn.QueryAsync<CallLogDto>(
                CallSelect("TOP (@take)") + @"
                WHERE k.Cal_Loc = @location
                  AND (@search IS NULL
                       OR ISNULL(oc.Clt_Name, mc.Clt_Name) LIKE '%' + @search + '%'
                       OR (@digits <> '' AND REPLACE(REPLACE(REPLACE(k.Cal_Phone, ' ', ''), '-', ''), '+', '') LIKE '%' + @digits + '%'))
                  AND (@from IS NULL OR k.Cal_CDStamp >= @from)
                  AND (@toEnd IS NULL OR k.Cal_CDStamp < @toEnd)
                ORDER BY k.Cal_RecID DESC;",
                new { location, ringSeconds, take, search, digits = digits ?? "", from = from?.Date, toEnd = to?.Date.AddDays(1) });
            return rows.ToList();
        }

        public async Task<CallLogDto?> GetCall(decimal id, int ringSeconds)
        {
            using var cn = Connection();
            return await cn.QueryFirstOrDefaultAsync<CallLogDto>(CallSelect() + " WHERE k.Cal_RecID = @id;", new { id, ringSeconds });
        }

        private static string? NullIfWhite(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

        // The user stamp columns hold 4 characters: the signed-in user, else appsettings "Orders:UserStamp".
        private string Stamp(string? user)
        {
            var s = (string.IsNullOrWhiteSpace(user) ? options.UserStamp : user).Trim();
            return s.Length > FieldLimits.UserStamp ? s[..FieldLimits.UserStamp] : s;
        }
    }
}
