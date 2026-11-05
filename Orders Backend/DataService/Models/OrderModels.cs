using System.ComponentModel.DataAnnotations;

namespace DataService.Models.DTOs
{
    public class OrderDto
    {
        public decimal RecID { get; set; }
        public string? ClientLoc { get; set; }
        public decimal? ClientID { get; set; }
        public string? ClientNbr { get; set; }
        public string? ClientName { get; set; }
        public string? ClientPhone1 { get; set; }
        public string? ClientPhone2 { get; set; }
        public string? ClientAddress { get; set; }
        public string? Phone { get; set; }
        /// <summary>Where this order goes when it is not the client's address; null = the client's address.</summary>
        public string? Address { get; set; }
        public string OrderText { get; set; } = string.Empty;
        /// <summary>Under process | Ready | Ready to be delivered | Completed, or a status the user typed in.</summary>
        public string Status { get; set; } = OrderStatus.UnderProcess;
        /// <summary>When the order was last set to Completed; null while it isn't Completed.</summary>
        public DateTime? CompletedAt { get; set; }
        public DateTime CDStamp { get; set; }
        public string? CUStamp { get; set; }
        public DateTime? MDStamp { get; set; }
    }

    public class SaveOrderRequest
    {
        public decimal? RecID { get; set; }
        public string? ClientLoc { get; set; }
        public decimal? ClientID { get; set; }
        /// <summary>Set instead of ClientLoc/ClientID when the caller is not a client yet: created with the order.</summary>
        public NewClientRequest? NewClient { get; set; }
        public string? Phone { get; set; }
        /// <summary>Delivery address for this order only; null or blank = the client's address.</summary>
        public string? Address { get; set; }
        public string OrderText { get; set; } = string.Empty;
        /// <summary>Blank = Under process for a new order, unchanged for an existing one.</summary>
        public string? Status { get; set; }
        /// <summary>The call (tbl_OrderCalls) this order was taken for, linked when it saves.</summary>
        public decimal? CallID { get; set; }
    }

    public class SetOrderStatusRequest
    {
        public string Status { get; set; } = string.Empty;
    }

    /// <summary>
    /// The statuses offered come from tbl_OrderStatus; a status typed in is added there when an
    /// order is saved with it. A status already listed is stored with the list's spelling,
    /// whatever the case typed. These are the four the screens colour.
    /// </summary>
    public static class OrderStatus
    {
        public const string UnderProcess = "Under process";
        public const string Ready = "Ready";
        public const string ReadyToBeDelivered = "Ready to be delivered";
        public const string Completed = "Completed";
        public const int MaxLength = 50;
    }

    /// <summary>One row of tbl_OrderStatus: a status the screens offer, in SortOrder.</summary>
    public class OrderStatusDto
    {
        public decimal RecID { get; set; }
        public string Name { get; set; } = string.Empty;
        public int SortOrder { get; set; }
    }

    /// <summary>One row of tbl_OrderStatusLog: the order got this status at that date.</summary>
    public class OrderStatusLogDto
    {
        public decimal RecID { get; set; }
        public decimal OrderID { get; set; }
        public string Status { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public string? User { get; set; }
    }

    /// <summary>Column sizes in tbl_Orders / tbl_Clients / tbl_OrderCalls; the screens use the same limits (OrderModal.jsx).</summary>
    public static class FieldLimits
    {
        public const int ClientName = 200;    // Clt_Name nvarchar(200)
        public const int Phone = 50;          // Clt_Phone1, Ord_Phone, Cal_Phone varchar(50)
        public const int ClientAddress = 300; // Clt_Address varchar(300)
        public const int OrderAddress = 500;  // Ord_Address nvarchar(500)
        public const int UserStamp = 4;       // Ord_CUStamp, Ord_MUStamp, Clt_Ustmp, Cal_MUStamp
    }

    public class NewClientRequest
    {
        public string Name { get; set; } = string.Empty;
        public string Phone { get; set; } = string.Empty;
        public string? Address { get; set; }
    }

    public class ClientLookupDto
    {
        public string Loc { get; set; } = string.Empty;
        public decimal RecID { get; set; }
        public string? Nbr { get; set; }
        public string? Name { get; set; }
        public string? Phone1 { get; set; }
        public string? Phone2 { get; set; }
        public string? Address { get; set; }
    }

    public class PagedResult<T>
    {
        public List<T> Items { get; set; } = new();
        public int Total { get; set; }
    }

    /// <summary>Body the caller-id business sends (same contract as the restaurant integration).</summary>
    public class IncomingCallRequest
    {
        [Required(ErrorMessage = "MobileNumber is required.")]
        [RegularExpression(@"^(?=(?:.*\d){8,}).+$",
            ErrorMessage = "MobileNumber must contain at least 8 digits.")]
        [MaxLength(FieldLimits.Phone, ErrorMessage = "MobileNumber can't be longer than 50 characters.")]
        public string MobileNumber { get; set; } = string.Empty;

        /// <summary>1 INCOMING (ringing), 2 ONGOING (picked up on the phone). Missing = 1 (older app versions).</summary>
        public int? CallType { get; set; }

        /// <summary>"INCOMING" / "ONGOING" - informative, CallType decides.</summary>
        public string? CallTypeName { get; set; }

        public bool IsAnsweredOnPhone => CallType == CallTypes.Ongoing
            || (CallType == null && string.Equals(CallTypeName, "ONGOING", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>callType values the CallerID app sends.</summary>
    public static class CallTypes
    {
        public const int Incoming = 1;
        public const int Ongoing = 2;
    }

    /// <summary>Answer to the caller-id business: Status "success" once the screens were notified.</summary>
    public class IncomingCallResponse
    {
        public string Status { get; set; } = "success";
        public string MobileNumber { get; set; } = string.Empty;
    }

    /// <summary>How the caller's number matched tbl_Clients.</summary>
    public static class CallMatch
    {
        public const string Unknown = "Unknown";
        public const string Found = "Found";
        public const string Multiple = "Multiple";
    }

    /// <summary>
    /// Pushed to the Orders screens over SignalR ("IncomingCall").
    /// Match: Unknown (no client), Found (one client), Multiple (the user picks one).
    /// </summary>
    public class IncomingCallEvent
    {
        public string CallId { get; set; } = Guid.NewGuid().ToString("N");
        public string Phone { get; set; } = string.Empty;
        public string Match { get; set; } = CallMatch.Unknown;
        public List<ClientLookupDto> Clients { get; set; } = new();
        public string Location { get; set; } = string.Empty;
        public DateTime ReceivedAt { get; set; } = DateTime.Now;
        /// <summary>How long the screens ring before the call counts as missed.</summary>
        public int RingSeconds { get; set; }
        /// <summary>Already picked up on the phone (ONGOING came without an INCOMING first): no ringing, just take the order.</summary>
        public bool Answered { get; set; }
    }

    /// <summary>Effective state of a logged call (tbl_OrderCalls), as the call history shows it.</summary>
    public static class CallStatus
    {
        public const string Ringing = "Ringing";
        public const string Answered = "Answered";
        public const string Handled = "Handled";
        /// <summary>Never stored: a Ringing call nobody took within RingSeconds.</summary>
        public const string Missed = "Missed";
        /// <summary>Never stored: an order was taken for the call.</summary>
        public const string Ordered = "Ordered";
    }

    /// <summary>One row of the call history (bell).</summary>
    public class CallLogDto
    {
        public decimal RecID { get; set; }
        public string Phone { get; set; } = string.Empty;
        public string Match { get; set; } = CallMatch.Unknown;
        public int MatchCount { get; set; }
        /// <summary>The order's client when an order was taken, else the one matching client.</summary>
        public string? ClientName { get; set; }
        public string Status { get; set; } = CallStatus.Ringing;
        public decimal? OrderID { get; set; }
        public DateTime ReceivedAt { get; set; }
        public DateTime? TakenAt { get; set; }
    }

    /// <summary>"IncomingCall" section of appsettings.json.</summary>
    public class IncomingCallOptions
    {
        /// <summary>Key the provider sends in the X-Api-Key header; calls are refused while it is empty.</summary>
        public string ApiKey { get; set; } = string.Empty;

        /// <summary>
        /// false: calls without an X-Api-Key header are accepted too (the Caller ID app can't send one yet).
        /// A key that is sent must still be right.
        /// </summary>
        public bool RequireApiKey { get; set; } = true;

        /// <summary>Seconds the screens ring; a call nobody answers in that time is a missed call.</summary>
        public int RingSeconds { get; set; } = 45;
    }

    /// <summary>"Orders" section of appsettings.json: where and how new clients are created.</summary>
    public class OrdersOptions
    {
        public string ClientLoc { get; set; } = "01";
        public string UserStamp { get; set; } = "WEB";
        public string ClientType { get; set; } = "SPC";
        public string ClientClass { get; set; } = "R";
        public string ClientCurrency { get; set; } = "$";
        public string ClientUsePrice { get; set; } = "1";
        public string ClientZeroSLPrice { get; set; } = "N";
        /// <summary>The country's dialing code, left out when matching callers to client phones (Lebanon: 961).</summary>
        public string CountryCode { get; set; } = "961";
    }

    public class CompanyInfoDto
    {
        public string? Comp_Code { get; set; }
        public string? Comp_Name { get; set; }
        public string? Comp_AbrName { get; set; }
        public string? Comp_Addr { get; set; }
        public string? Comp_Phone1 { get; set; }
    }
}
