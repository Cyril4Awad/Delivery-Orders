using DataService.DataAccess;
using DataService.Models.DTOs;
using DataService.Others;
using Microsoft.Extensions.Options;

namespace DataService.Engines.Orders
{
    public class OrdersEngine
    {
        private readonly OrdersDAL _dal;
        private readonly OrdersOptions _options;
        private readonly IncomingCallOptions _callOptions;

        public OrdersEngine(OrdersDAL dal, IOptions<OrdersOptions> options, IOptions<IncomingCallOptions> callOptions)
        {
            _dal = dal;
            _options = options.Value;
            _callOptions = callOptions.Value;
        }

        private int RingSeconds => Math.Max(5, _callOptions.RingSeconds);

        /// <summary>The location this backend serves (appsettings "Orders:ClientLoc").</summary>
        public string Location => _options.ClientLoc;

        public Task<List<OrderDto>> GetOrders() => _dal.GetOrders();

        public Task<OrderDto?> GetOrderById(decimal id) => _dal.GetOrderById(id);

        public Task<PagedResult<ClientLookupDto>> SearchClients(string? search, int page, int pageSize) =>
            _dal.SearchClients(search, Math.Max(1, page), Math.Clamp(pageSize, 1, 200));

        public Task<CompanyInfoDto?> GetCompanyInfo() => _dal.GetCompanyInfo();

        public Task<byte[]?> GetLogo() => _dal.GetLogo();

        public async Task<OrderDto> SaveOrder(SaveOrderRequest order, string? user)
        {
            if (IsBlankText(order.OrderText))
                throw new ValidationException("Order text is required.");
            if ((order.ClientID == null) != string.IsNullOrWhiteSpace(order.ClientLoc))
                throw new ValidationException("Client location and id must be provided together.");

            if (order.NewClient != null)
            {
                if (order.ClientID != null)
                    throw new ValidationException("Pick an existing client or enter a new one, not both.");
                if (string.IsNullOrWhiteSpace(order.NewClient.Name))
                    throw new ValidationException("Client name is required.");
                if (string.IsNullOrWhiteSpace(order.NewClient.Phone))
                    throw new ValidationException("Client phone is required.");

                order.Phone ??= order.NewClient.Phone;
                CheckLength(order.NewClient.Name, FieldLimits.ClientName, "Client name");
                CheckLength(order.NewClient.Phone, FieldLimits.Phone, "Client phone");
                CheckLength(order.NewClient.Address, FieldLimits.ClientAddress, "Client address");
            }
            CheckLength(order.Phone, FieldLimits.Phone, "Phone");
            CheckLength(order.Address, FieldLimits.OrderAddress, "Delivery address");

            order.Status = string.IsNullOrWhiteSpace(order.Status) ? null : await CleanStatus(order.Status);
            return await _dal.SaveOrder(order, user);
        }

        public async Task SetStatus(decimal id, string? status, string? user) => await _dal.SetStatus(id, await CleanStatus(status), user);

        /// <summary>The statuses offered (tbl_OrderStatus), in their order.</summary>
        public Task<List<OrderStatusDto>> GetStatuses() => _dal.GetStatuses();

        /// <summary>Every status the order had, oldest first (tbl_OrderStatusLog).</summary>
        public async Task<List<OrderStatusLogDto>> GetStatusLog(decimal orderId)
        {
            if (await _dal.GetOrderById(orderId) == null) throw new NotFoundException($"Order {orderId} not found.");
            return await _dal.GetStatusLog(orderId);
        }

        /// <summary>The client's latest orders (shown in the order screen when the client calls).</summary>
        public Task<List<OrderDto>> GetClientOrders(string clientLoc, decimal clientId, int take, decimal? exceptId) =>
            _dal.GetClientOrders(clientLoc, clientId, Math.Clamp(take, 1, 20), exceptId);

        // Measured as saved (trimmed), against the column size.
        private static void CheckLength(string? value, int max, string field)
        {
            if ((value?.Trim().Length ?? 0) > max)
                throw new ValidationException($"{field} can't be longer than {max} characters.");
        }

        // A typed status is kept as typed (trimmed, spaces collapsed); one already listed in
        // tbl_OrderStatus gets the list's spelling.
        private async Task<string> CleanStatus(string? status)
        {
            var s = System.Text.RegularExpressions.Regex.Replace(status ?? string.Empty, @"\s+", " ").Trim();
            if (s.Length == 0) throw new ValidationException("Status is required.");
            if (s.Length > OrderStatus.MaxLength)
                throw new ValidationException($"Status can't be longer than {OrderStatus.MaxLength} characters.");
            var listed = await _dal.GetStatuses();
            return listed.FirstOrDefault(k => string.Equals(k.Name, s, StringComparison.OrdinalIgnoreCase))?.Name ?? s;
        }

        /// <summary>
        /// Called for each call the caller-id business reports. Looks the number up in tbl_Clients
        /// (Phone 1 and Phone 2): no client is Unknown, one is Found, several are Multiple and the
        /// user picks one on screen. The call is logged in tbl_OrderCalls; its id is the CallId.
        /// </summary>
        public async Task<IncomingCallEvent> AcknowledgeIncomingCall(IncomingCallRequest request)
        {
            if (request == null)
                throw new ValidationException("Request is required.");
            if (string.IsNullOrWhiteSpace(request.MobileNumber))
                throw new ValidationException("MobileNumber is required.");

            var call = await LookupCaller(request.MobileNumber.Trim());
            call.CallId = (await _dal.LogCall(call)).ToString("0");
            return call;
        }

        // An ONGOING up to this long after the INCOMING still belongs to that call.
        private const int AnsweredMatchMinutes = 10;

        /// <summary>
        /// ONGOING from the phone app: the call was picked up there, so it is not missed. Returns
        /// (callId, null) when it matched the ringing call, or (callId, new call) when no INCOMING came
        /// first - that call is logged already Answered and shown to the screens to take the order.
        /// </summary>
        public async Task<(string CallId, IncomingCallEvent? NewCall)> CallAnsweredOnPhone(IncomingCallRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.MobileNumber))
                throw new ValidationException("MobileNumber is required.");

            var phone = request.MobileNumber.Trim();
            var id = await _dal.MarkAnsweredOnPhone(Location, phone, AnsweredMatchMinutes);
            if (id != null) return (id.Value.ToString("0"), null);

            var call = await LookupCaller(phone);
            call.Answered = true;
            call.CallId = (await _dal.LogCall(call)).ToString("0");
            return (call.CallId, call);
        }

        private async Task<IncomingCallEvent> LookupCaller(string phone)
        {
            var call = new IncomingCallEvent { Phone = phone, Location = Location, RingSeconds = RingSeconds };
            var caller = NormalizePhone(phone);
            if (caller.Length > 0)
            {
                call.Clients = (await _dal.GetClientsWithPhones())
                    .Where(c => NormalizePhone(c.Phone1) == caller || NormalizePhone(c.Phone2) == caller)
                    .OrderBy(c => c.Name)
                    .ToList();
            }

            call.Match = call.Clients.Count switch
            {
                0 => CallMatch.Unknown,
                1 => CallMatch.Found,
                _ => CallMatch.Multiple,
            };
            return call;
        }

        /// <summary>First screen to answer gets the call (see OrdersDAL.TakeCall).</summary>
        public async Task<bool> TakeCall(string callId, string connectionId)
        {
            // not one of ours (e.g. logged before an upgrade): nothing to compete for
            if (!decimal.TryParse(callId, out var id)) return true;
            return await _dal.TakeCall(id, connectionId);
        }

        public Task<List<CallLogDto>> GetCalls(int take, string? search = null, DateTime? from = null, DateTime? to = null) =>
            _dal.GetCalls(Location, RingSeconds, Math.Clamp(take, 1, 500), search, from, to);

        /// <summary>Stores Missed on calls that rang out; returns the locations that had some.</summary>
        public Task<List<string>> MarkMissedCalls() => _dal.MarkMissedCalls(RingSeconds);

        /// <summary>
        /// A logged call, looked up again against today's clients, to take an order for it later
        /// (missed call, call put on hold).
        /// </summary>
        public async Task<IncomingCallEvent> GetCallForOrder(decimal id)
        {
            var logged = await _dal.GetCall(id, RingSeconds) ?? throw new NotFoundException($"Call {id} not found.");
            var call = await LookupCaller(logged.Phone);
            call.CallId = logged.RecID.ToString("0");
            call.ReceivedAt = logged.ReceivedAt;
            return call;
        }

        public Task MarkCallHandled(decimal id, string? user) => _dal.MarkCallHandled(id, user);

        // The order text is rich text (HTML): "<p><br></p>" is still empty.
        private static bool IsBlankText(string? html)
        {
            if (string.IsNullOrWhiteSpace(html)) return true;
            var text = System.Text.RegularExpressions.Regex.Replace(html, "<[^>]*>", " ")
                .Replace("&nbsp;", " ", StringComparison.OrdinalIgnoreCase);
            return string.IsNullOrWhiteSpace(text);
        }

        // Compares numbers on their local part: digits only, without the country code (Orders:CountryCode)
        // or leading zeros.
        private string NormalizePhone(string? phone)
        {
            if (string.IsNullOrWhiteSpace(phone)) return string.Empty;
            var digits = new string(phone.Where(char.IsDigit).ToArray()).TrimStart('0');
            var cc = (_options.CountryCode ?? string.Empty).Trim().TrimStart('+', '0');
            if (cc.Length > 0 && digits.StartsWith(cc) && digits.Length > cc.Length + 6) digits = digits[cc.Length..];
            return digits.TrimStart('0');
        }
    }
}
