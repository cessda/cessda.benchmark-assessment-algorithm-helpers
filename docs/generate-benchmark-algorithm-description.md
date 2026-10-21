# GenerateBenchmarkAlgorithmDescription.gs

`GenerateBenchmarkAlgorithmDescription.gs` provides the **FAIR Metrics >
Generate Report** menu item. For each Test GUID in the algorithm, it fetches
the test's RDF record and the record of each metric it implements, and writes a
summary report to a new sheet.

## Setup

1. Open your Google Benchmark Assessment algorithm spreadsheet.
2. Go to **Extensions > Apps Script**.
3. Copy each file from the `scripts` directory into the project, keeping the
   file names. All four files are needed; see [Dependencies](#dependencies).
4. Save the project and close the editor.
5. Reload the spreadsheet so that the **FAIR Metrics** menu appears.

## Preparing the spreadsheet

- The sheet holding the algorithm must be named `Algorithm`, or the name set
  in `CONFIG.sourceSheetName`.
- Column B must contain hyperlinks to the test descriptions, in the cells
  between the cell containing `Test GUID` and the cell containing
  `Description`.
- Processing starts in the cell below `Test GUID`. It stops at a cell
  containing `Description`, after three consecutive empty cells, or at the end
  of the sheet.

## Running the script

1. Choose **FAIR Metrics > Generate Report**.
2. Wait while each link is processed. Allow roughly 2 to 3 seconds per test.
3. A dialogue reports the number of entries written.

## The report

The script writes to a sheet called `Description` (or `CONFIG.targetSheetName`),
creating it if necessary. **An existing sheet of that name is cleared on every
run.** The report has four columns:

| Column | Header | Content |
|---|---|---|
| A | Metric name(s) | Title of each metric, separated by semicolons |
| B | Metric URL(s) | URL of each metric, separated by semicolons |
| C | Test URL | The Test GUID hyperlink |
| D | Test description | Description taken from the test record |

If a test cannot be processed, its row shows `Error` in columns A and B and
the error message in column D, and the run continues with the next test.
Missing values are shown as `N/A`.

## How it works

For each hyperlink, the script resolves the data in two steps.

1. **Fetch the test record** (an `ftr:Test` DCAT record) at the Test URL.
   - `dcterms:description` becomes the test description.
   - Each object of `sio:SIO_000233` is a metric URL.
2. **Fetch each metric record** (a `dqv:Metric` DCAT record) at its URL.
   - `dcterms:title` becomes the metric name.
   - If there is no title, `rdfs:label` is used, then the metric URL itself.
   - If the metric cannot be fetched, the metric URL is used as its name.

A pause of `CONFIG.requestDelayMs` follows each test.

### RDF serialisation

The OSTrails test registry serves Turtle using full URIs, such as
`<http://purl.org/dc/terms/description>`, rather than prefixed names. Every
extraction pattern therefore tries the full-URI form first and the prefixed
form (`dcterms:description`) second. Extraction handles language-tagged,
datatype-tagged, single-quoted and triple-quoted literals. Descriptions also
have an XML/RDF fallback.

Requests send an `Accept: text/turtle` header, so that servers return Turtle.

An example test record:

```turtle
<testUrl>
  <http://purl.org/dc/terms/description> "..."@en ;
  <http://semanticscience.org/resource/SIO_000233> <metricUrl> ;
  a <http://www.w3.org/ns/dcat#DataService>, <https://w3id.org/ftr#Test> .
```

## Functions

| Function | Purpose |
|---|---|
| `generateFAIRMetricsReport()` | Menu entry point. |
| `extractMetricsData()` | Loops over rows and resolves each test. |
| `findSIO000233Objects()` | Finds the metric URLs in a test record. |
| `extractDctermsDescription()` | Extracts the test description. |
| `extractDctermsTitle()` | Extracts a metric title. |
| `extractRdfsLabel()` | Fallback metric name from `rdfs:label`. |
| `extractUrlFromFormula()` | Reads the URL from a `HYPERLINK` formula. |
| `fetchUrl()` | Fetches a URL as Turtle; throws if not 200. |
| `getOrCreateSheet()` | Returns the target sheet, cleared. |
| `writeReport()` | Writes headers and rows, then resizes columns |

## Customisation

### Adding fields from the test record

To add a field, such as the creator of a test:

1. Write an extraction function modelled on `extractDctermsDescription()`.
   Try both the full-URI and prefixed predicate forms.
2. Call it in `extractMetricsData()` after the test record is fetched.
3. Add the value to the object passed to `data.push()`, in both the success
   and the error branch.
4. In `writeReport()`, add a header to `headers` and the value to the row
   mapping, keeping the two in the same order.

Common predicates:

- `<http://purl.org/dc/terms/title>`: title
- `<http://purl.org/dc/terms/creator>`: creator
- `<http://purl.org/dc/terms/created>`: creation date
- `<http://purl.org/dc/terms/identifier>`: identifier

Adjust the pattern to match how the value is written:

- **Quoted values**: `/<field>\s+"([^"]*)"/`
- **IRIs**: `/<field>\s+<([^>]+)>/`

### Adding fields from the metric record

Follow the same steps, but call the new extraction function in the `map()`
over `metricUrls`, where `metricRdf` is available.

## Debug helpers

Run these manually from the Apps Script editor. Results appear in the
execution log.

| Function | Purpose |
|---|---|
| `debugSourceColumn()` | Logs the first 20 rows of the source column |
| `debugSingleTest()` | Resolves one test; edit `DEBUG_TEST_URL` to change it |

## Dependencies

- `CONFIG` from [MenuAndConfig.gs](menu-and-config.md)
- `extractUrlFromFormula()`, defined here, is also used by
  [ValidateTestReferences.gs](validate-test-references.md)
- `findStartRowFromArray()` is declared both here and in `MenuAndConfig.gs`
  with identical behaviour

## Troubleshooting

- **View detailed logs**: **Extensions > Apps Script > Executions**.
- **No URL found for a row**: run `debugSourceColumn()` to see whether the
  cell holds a `HYPERLINK` formula or a rich-text link.
- **The script times out**: Apps Script limits execution time. Reduce the
  number of tests, or run the report in sections.
- **A row shows `HTTP 4xx` in the description**: the test or metric URL
  could not be fetched. Open the URL to check it.
- **A metric name is its URL**: the metric record has no `dcterms:title` or
  `rdfs:label`, or could not be fetched.
