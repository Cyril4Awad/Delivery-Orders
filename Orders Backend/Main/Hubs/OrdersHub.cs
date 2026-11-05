using DataService.Engines.Orders;
using Microsoft.AspNetCore.SignalR;

namespace Main.Hubs
{
    /// <summary>
    /// Real-time channel to the Orders screens: /hubs/orders
    /// Server → client messages:
    ///   "IncomingCall"   IncomingCallEvent - a call to answer (rings the screen)
    ///   "CallTaken"      { callId }         - another screen took its order, stop ringing
    ///   "CallAnswered"   { callId }         - picked up on the phone: stop ringing, its order is still to take
    ///   "OrdersChanged"  { recId }          - an order was saved or completed, reload the list
    ///   "CallsChanged"   { callId }         - a call was marked handled, reload the call history
    /// Client → server:
    ///   TakeCall(callId) → true when this screen got the call, false when another one already had
    /// Every screen joins the group of the location this backend serves, so only that
    /// location's screens ring.
    /// </summary>
    public class OrdersHub : Hub
    {
        private readonly OrdersEngine engine;

        public OrdersHub(OrdersEngine engine)
        {
            this.engine = engine;
        }

        public static string LocationGroup(string location) => $"loc-{location}";

        public override async Task OnConnectedAsync()
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, LocationGroup(engine.Location));
            await base.OnConnectedAsync();
        }

        public async Task<bool> TakeCall(string callId)
        {
            if (string.IsNullOrWhiteSpace(callId) || !await engine.TakeCall(callId, Context.ConnectionId))
                return false;

            await Clients.OthersInGroup(LocationGroup(engine.Location)).SendAsync("CallTaken", new { callId });
            return true;
        }
    }
}
