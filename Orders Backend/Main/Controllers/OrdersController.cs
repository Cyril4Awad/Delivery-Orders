using DataService.Engines.Orders;
using DataService.Models.DTOs;
using Main.Hubs;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;

namespace Main.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class OrdersController : ControllerBase
    {
        private readonly OrdersEngine engine;
        private readonly IHubContext<OrdersHub> hub;

        public OrdersController(OrdersEngine engine, IHubContext<OrdersHub> hub)
        {
            this.engine = engine;
            this.hub = hub;
        }

        // Tells the other Orders screens of this location to reload their list.
        private Task NotifyOrdersChanged(decimal recId) =>
            hub.Clients.Group(OrdersHub.LocationGroup(engine.Location)).SendAsync("OrdersChanged", new { recId });

        private string? CurrentUser => User?.Identity?.Name is { Length: > 0 } n ? n[..Math.Min(4, n.Length)] : null;

        [HttpGet]
        public async Task<IActionResult> GetOrders()
        {
            return Ok(await engine.GetOrders());
        }

        [HttpPost]
        public async Task<IActionResult> SaveOrder([FromBody] SaveOrderRequest order)
        {
            var saved = await engine.SaveOrder(order, CurrentUser);
            await NotifyOrdersChanged(saved.RecID);
            return Ok(saved);
        }

        /// <summary>Under process | Ready | Ready to be delivered | Completed, or any status typed in (up to 50 characters).</summary>
        [HttpPut("{id}/status")]
        public async Task<IActionResult> SetStatus(decimal id, [FromBody] SetOrderStatusRequest body)
        {
            await engine.SetStatus(id, body?.Status, CurrentUser);
            await NotifyOrdersChanged(id);
            return Ok(await engine.GetOrderById(id));
        }

        /// <summary>The statuses offered in the lists (tbl_OrderStatus), in their order: [{ recID, name, sortOrder }].</summary>
        [HttpGet("Statuses")]
        public async Task<IActionResult> GetStatuses()
        {
            return Ok(await engine.GetStatuses());
        }

        /// <summary>Every status the order had, oldest first: [{ recID, orderID, status, date, user }].</summary>
        [HttpGet("{id}/StatusLog")]
        public async Task<IActionResult> GetStatusLog(decimal id)
        {
            return Ok(await engine.GetStatusLog(id));
        }

        /// <summary>
        /// The call history (bell): latest calls, newest first. Filters: `search` = number or client name,
        /// `from` / `to` = days (yyyy-MM-dd, both included).
        /// </summary>
        [HttpGet("Calls")]
        public async Task<IActionResult> GetCalls([FromQuery] int take = 100, [FromQuery] string? search = null,
            [FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
        {
            return Ok(await engine.GetCalls(take, search, from, to));
        }

        /// <summary>A logged call with its caller looked up again, to take an order for it now.</summary>
        [HttpGet("Calls/{id}")]
        public async Task<IActionResult> GetCall(decimal id)
        {
            return Ok(await engine.GetCallForOrder(id));
        }

        [HttpPut("Calls/{id}/handled")]
        public async Task<IActionResult> MarkCallHandled(decimal id)
        {
            await engine.MarkCallHandled(id, CurrentUser);
            await hub.Clients.Group(OrdersHub.LocationGroup(engine.Location)).SendAsync("CallsChanged", new { callId = id });
            return Ok(new { recId = id });
        }

        /// <summary>The client's latest orders, newest first (`exceptId`: the order being edited, left out).</summary>
        [HttpGet("Clients/{loc}/{id}/Orders")]
        public async Task<IActionResult> GetClientOrders(string loc, decimal id, [FromQuery] int take = 3, [FromQuery] decimal? exceptId = null)
        {
            return Ok(await engine.GetClientOrders(loc, id, take, exceptId));
        }

        [HttpGet("Clients")]
        public async Task<IActionResult> SearchClients([FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int pageSize = 25)
        {
            return Ok(await engine.SearchClients(search, page, pageSize));
        }
    }
}
