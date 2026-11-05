using DataService.Engines.Orders;
using DataService.Models.DTOs;
using DataService.Others;
using Main.Hubs;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;

namespace Main.Controllers
{
    /// <summary>
    /// Entry point for the caller-id provider.
    /// POST /api/incoming-call   header X-Api-Key: &lt;IncomingCall:ApiKey&gt;   body { "mobileNumber": "70334074" }
    /// (the header may be left out while IncomingCall:RequireApiKey is false)
    /// The CallerID app also sends "callType": 1 INCOMING (ringing), 2 ONGOING (picked up on the phone:
    /// the screens stop ringing, the call is Answered - not missed - and its order is still to take).
    /// Looks the number up and pushes "IncomingCall" (Unknown | Found | Multiple, with the clients)
    /// to the Orders screens of this location over SignalR, then answers { status, mobileNumber }.
    /// </summary>
    [ApiController]
    [Route("api/incoming-call")]
    public class IncomingCallController : ControllerBase
    {
        private readonly OrdersEngine _engine;
        private readonly IHubContext<OrdersHub> _hub;
        private readonly IncomingCallOptions _options;

        public IncomingCallController(OrdersEngine engine, IHubContext<OrdersHub> hub, IOptions<IncomingCallOptions> options)
        {
            _engine = engine;
            _hub = hub;
            _options = options.Value;
        }

        [HttpPost]
        public async Task<ActionResult<IncomingCallResponse>> Post([FromBody] IncomingCallRequest request)
        {
            if (!IsApiKeyValid())
            {
                return Unauthorized(new { Message = "Invalid or missing API key." });
            }

            try
            {
                var screens = _hub.Clients.Group(OrdersHub.LocationGroup(_engine.Location));
                if (request.IsAnsweredOnPhone)
                {
                    // picked up on the phone: stop ringing everywhere, the order still has to be taken
                    var (callId, newCall) = await _engine.CallAnsweredOnPhone(request);
                    if (newCall != null) await screens.SendAsync("IncomingCall", newCall);
                    else await screens.SendAsync("CallAnswered", new { callId });
                    return Ok(new IncomingCallResponse { Status = "success", MobileNumber = request.MobileNumber.Trim() });
                }

                var call = await _engine.AcknowledgeIncomingCall(request);
                await screens.SendAsync("IncomingCall", call);
                return Ok(new IncomingCallResponse { Status = "success", MobileNumber = call.Phone });
            }
            catch (ValidationException ex)
            {
                return BadRequest(new { Message = ex.Message });
            }
        }

        private bool IsApiKeyValid()
        {
            if (!Request.Headers.TryGetValue("X-Api-Key", out var providedValues))
            {
                return !_options.RequireApiKey;
            }

            var expected = (_options.ApiKey ?? string.Empty).Trim();
            if (expected.Length == 0)
            {
                return false;
            }

            var provided = (providedValues.ToString() ?? string.Empty).Trim();
            return provided.Length > 0
                && string.Equals(provided, expected, StringComparison.Ordinal);
        }
    }
}
