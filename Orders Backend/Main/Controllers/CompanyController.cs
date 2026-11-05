using DataService.Engines.Orders;
using DataService.Models.DTOs;
using Microsoft.AspNetCore.Mvc;

namespace Main.Controllers
{
    /// <summary>
    /// Company identity for report headers.
    /// GET /api/Company/info → { comp_Code, comp_Name, comp_AbrName, comp_Addr, comp_Phone1 }
    /// GET /api/Company/logo → the logo image (COm_Logo.L_Img), 204 when there is none
    /// </summary>
    [Route("api/[controller]")]
    [ApiController]
    public class CompanyController : ControllerBase
    {
        private readonly OrdersEngine engine;

        public CompanyController(OrdersEngine engine)
        {
            this.engine = engine;
        }

        [HttpGet("info")]
        public async Task<IActionResult> GetInfo()
        {
            return Ok(await engine.GetCompanyInfo() ?? new CompanyInfoDto());
        }

        [HttpGet("logo")]
        public async Task<IActionResult> GetLogo()
        {
            var bytes = await engine.GetLogo();
            if (bytes == null || bytes.Length == 0) return NoContent();
            return File(bytes, SniffImageType(bytes));
        }

        private static string SniffImageType(byte[] b) =>
            b.Length > 3 && b[0] == 0x89 && b[1] == 0x50 ? "image/png"
            : b.Length > 2 && b[0] == 0xFF && b[1] == 0xD8 ? "image/jpeg"
            : b.Length > 2 && b[0] == 0x47 && b[1] == 0x49 ? "image/gif"
            : "image/bmp";
    }
}
