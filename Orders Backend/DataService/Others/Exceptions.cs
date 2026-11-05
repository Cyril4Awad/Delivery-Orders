using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Data.SqlClient;

namespace DataService.Others
{
    public class NotFoundException : Exception
    {
        public NotFoundException(string message) : base(message) { }
    }
    public class ValidationException : Exception
    {
        public ValidationException(string message) : base(message) { }
    }
    public class UnauthorizedAccessException : Exception
    {
        public UnauthorizedAccessException(string message) : base(message) { }
    }
    public class InternalServerErrorException : Exception
    {
        public InternalServerErrorException(string message) : base(message) { }
    }
    public class GlobalExceptionFilter : IExceptionFilter
    {
        public void OnException(ExceptionContext context)
        {
            if (context.Exception is SqlException sql && DescribeSqlError(sql) is var (sqlStatus, sqlMessage))
            {
                // forUser: written for the screen, shown as it is even on a 5xx
                context.Result = new ObjectResult(new { error = sqlMessage, forUser = true, detail = sql.Message }) { StatusCode = sqlStatus };
                return;
            }

            var statusCode = context.Exception switch
            {
                NotFoundException => StatusCodes.Status404NotFound,

                ValidationException => StatusCodes.Status400BadRequest,

                UnauthorizedAccessException => StatusCodes.Status401Unauthorized,

                _ => StatusCodes.Status500InternalServerError
            };

            context.Result = new ObjectResult(new
            {
                error = context.Exception.Message,
                //stackTrace = context.Exception.StackTrace,
                innerException = context.Exception.InnerException?.Message
            })
            {
                StatusCode = statusCode,
            };
        }

        // SQL Server errors the user can understand or act on; null = a plain server fault.
        private static (int Status, string Message)? DescribeSqlError(SqlException ex) => ex.Number switch
        {
            // can't connect / login failed / database offline / timeout / connection dropped
            -2 or -1 or 2 or 53 or 64 or 233 or 4060 or 10053 or 10054 or 10060 or 10061 or 11001 or 18456 =>
                (StatusCodes.Status503ServiceUnavailable, "Can't reach the database. Check that SQL Server is running and the connection settings are right."),
            1205 => (StatusCodes.Status503ServiceUnavailable, "The database was busy. Try again."),
            2628 or 8152 => (StatusCodes.Status400BadRequest, "One of the fields is too long to be saved. Shorten it and try again."),
            547 => (StatusCodes.Status400BadRequest, "This refers to a record that no longer exists (e.g. the client was removed). Refresh and try again."),
            2601 or 2627 => (StatusCodes.Status409Conflict, "The same record was saved from another screen at the same time. Try again."),
            // invalid column / object: the tables are older or newer than this version of the service
            207 or 208 => (StatusCodes.Status500InternalServerError,
                $"The database doesn't match this version of the Orders service ({ex.Message}). Run the SQL scripts and publish the latest backend."),
            _ => null,
        };
    }
}
