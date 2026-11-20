using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;
using System.Text.Json;

if (args.Length == 0) throw new ArgumentException("Provide generated workbook paths.");
var count = 0;
foreach (var path in args)
{
    using var document = SpreadsheetDocument.Open(path, false);
    var errors = new OpenXmlValidator().Validate(document).Select(e => new {
        e.Id, e.Description, Part=e.Part?.Uri.ToString(), Path=e.Path?.XPath
    }).ToArray();
    count += errors.Length;
    Console.WriteLine(JsonSerializer.Serialize(new { File=Path.GetFileName(path), ErrorCount=errors.Length, Errors=errors }));
}
Environment.ExitCode = count == 0 ? 0 : 1;
