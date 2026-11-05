using DataService.Engines.Orders;
using Microsoft.AspNetCore.SignalR;

namespace Main.Hubs
{
    /// <summary>
    /// Every few seconds, stores Missed on the calls nobody took within IncomingCall:RingSeconds, so
    /// tbl_OrderCalls says Missed even when no screen is open, and tells those locations' screens to
    /// reload their call history ("CallsChanged").
    /// </summary>
    public class MissedCallsService : BackgroundService
    {
        private static readonly TimeSpan Interval = TimeSpan.FromSeconds(5);

        private readonly IServiceScopeFactory scopes;
        private readonly IHubContext<OrdersHub> hub;
        private readonly ILogger<MissedCallsService> logger;

        public MissedCallsService(IServiceScopeFactory scopes, IHubContext<OrdersHub> hub, ILogger<MissedCallsService> logger)
        {
            this.scopes = scopes;
            this.hub = hub;
            this.logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            using var timer = new PeriodicTimer(Interval);
            do
            {
                try
                {
                    using var scope = scopes.CreateScope();
                    var engine = scope.ServiceProvider.GetRequiredService<OrdersEngine>();
                    foreach (var location in await engine.MarkMissedCalls())
                        await hub.Clients.Group(OrdersHub.LocationGroup(location)).SendAsync("CallsChanged", new { }, stoppingToken);
                }
                catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
                {
                    // e.g. the database is briefly unreachable: try again on the next tick
                    logger.LogWarning(ex, "Marking missed calls failed.");
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
    }
}
