/**

 * @file GenerateBenchmarkAlgorithmDescription.gs

 * @description Google Apps Script that generates a FAIR Benchmark Assessment report

 *  by reading Test GUID hyperlinks from a source sheet, fetching the Turtle/RDF

 *  content at each URL, and extracting metric and description information.

 *

 * TECHNICAL DETAILS

 * -----------------

 * For each Test GUID hyperlink found in CONFIG.sourceColumn between the

 * startMarker row and the stopMarker row, the script performs a two-step

 * resolution:

 *

 *  Step 1 — Fetch the ftr:Test DCAT record at the Test URL.

 *       Extract the sio:SIO_000233 object URI → Column B (Metric URL).

 *       Extract dcterms:description → Column D (Test description).

 *

 *  Step 2 — Fetch the dqv:Metric DCAT record at the Metric URL.

 *       Extract dcterms:title → Column A (Metric name).

 *

 * NOTE ON RDF SERIALISATION

 * -------------------------

 * The OSTrails test registry serves Turtle using full URIs throughout —

 * predicates appear as <http://...> angle-bracket forms, NOT as prefixed

 * names (dcterms:, sio:, rdfs:, etc.). All regex patterns therefore match

 * both the full-URI form (primary) and the prefixed form (fallback), so the

 * script remains robust if the serialisation style changes.

 *

 * EXPECTED RDF FORMAT — ftr:Test record (Step 1)

 * -----------------------------------------------

 *  <testUrl>

 *    <http://purl.org/dc/terms/description> "…"@en ;

 *    <http://semanticscience.org/resource/SIO_000233> <metricUrl> ;

 *    a <http://www.w3.org/ns/dcat#DataService>, <https://w3id.org/ftr#Test> .

 *

 * EXPECTED RDF FORMAT — dqv:Metric record (Step 2)

 * -------------------------------------------------

 *  <metricUrl>

 *    <http://purl.org/dc/terms/title> "Metric Name"@en ;

 *    a <http://www.w3.org/ns/dqv#Metric> .

 *

 * SHEET LAYOUT (CONFIG.sourceSheetName, default "Algorithm")

 * -----------------------------------------------------------

 *  Column B - Marker text ("Test GUID" / "Description") and HYPERLINK cells

 *

 * OUTPUT (CONFIG.targetSheetName, default "Description")

 * -------------------------------------------------------

 *  Column 1 - Metric name(s)  (semicolon-separated if multiple per test)

 *  Column 2 - Metric URL(s)  (semicolon-separated if multiple per test)

 *  Column 3 - Test URL

 *  Column 4 - Test description

 */


// ── Configuration ─────────────────────────────────────────────────────────────


// CONFIG is declared in MenuAndConfig.gs — do not redeclare here.


// ── Entry point ───────────────────────────────────────────────────────────────


/**

 * Entry point for report generation. Reads hyperlinks from the source sheet,

 * performs the two-step RDF resolution for each test, then writes a summary

 * report to the target sheet.

 *

 * Failures for individual rows are caught and recorded as error entries in the

 * report rather than aborting the entire run.

 */

function generateFAIRMetricsReport() {

 const ss     = SpreadsheetApp.getActiveSpreadsheet();

 const sourceSheet = ss.getSheetByName(CONFIG.sourceSheetName);


 if (!sourceSheet) {

  SpreadsheetApp.getUi().alert(`Error: Sheet "${CONFIG.sourceSheetName}" not found`);

  return;

 }


 Logger.log('Starting report generation…');


 // ── Bulk-read the source column to avoid per-cell API calls ──────────────

 const maxRows     = sourceSheet.getLastRow();

 const sourceColValues = sourceSheet

  .getRange(`${CONFIG.sourceColumn}1:${CONFIG.sourceColumn}${maxRows}`)

  .getValues()

  .map(r => (r[0] == null ? '' : r[0].toString()));


 // ── Locate the startMarker ────────────────────────────────────────────────

 const startRow = findStartRowFromArray(sourceColValues);

 if (!startRow) {

  SpreadsheetApp.getUi().alert(

   `Error: "${CONFIG.startMarker}" not found in column ${CONFIG.sourceColumn}`

  );

  return;

 }

 Logger.log(`Start marker found; processing begins at row ${startRow}`);


 // ── Extract data ──────────────────────────────────────────────────────────

 const reportData = extractMetricsData(sourceSheet, sourceColValues, startRow, maxRows);

 Logger.log(`Extracted ${reportData.length} entries`);


 // ── Write report ──────────────────────────────────────────────────────────

 const targetSheet = getOrCreateSheet(ss, CONFIG.targetSheetName);

 writeReport(targetSheet, reportData);


 Logger.log('Report generation complete');

 SpreadsheetApp.getUi().alert(

  `Report generated with ${reportData.length} entries in "${CONFIG.targetSheetName}"`

 );

}


// ── Data extraction ───────────────────────────────────────────────────────────


/**

 * Iterates over rows from startRow until the stopMarker, an extended run of

 * empty cells, or the last row of the sheet.

 *

 * For each row containing a hyperlink:

 *  1. Fetches the ftr:Test DCAT record (Step 1).

 *  2. Extracts dcterms:description and all SIO_000233 Metric URLs.

 *  3. Fetches each Metric DCAT record (Step 2) and extracts dcterms:title.

 *

 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet      Source sheet object.

 * @param {string[]}              sourceColValues Pre-read column values (0-based).

 * @param {number}               startRow     First row to inspect (1-based).

 * @param {number}               maxRows     Last row in the sheet (1-based).

 * @returns {{ metricNames: string, metricUrls: string,

 *       testUrl: string, testDescription: string }[]}

 */

function extractMetricsData(sheet, sourceColValues, startRow, maxRows) {

 const data    = [];

 let  emptyCount = 0;


 for (let row = startRow; row <= maxRows; row++) {

  const cellText = sourceColValues[row - 1].trim();


  if (cellText === CONFIG.stopMarker) {

   Logger.log(`Stop marker found at row ${row}`);

   break;

  }


  if (cellText === '') {

   emptyCount++;

   Logger.log(`Empty cell at row ${row} (${emptyCount} consecutive)`);

   if (emptyCount >= CONFIG.maxConsecutiveEmpty) {

    Logger.log(`${CONFIG.maxConsecutiveEmpty} consecutive empty cells — stopping`);

    break;

   }

   continue;

  }

  emptyCount = 0;


  // Extract the hyperlink URL from the cell (formula or rich-text).

  const cell  = sheet.getRange(CONFIG.sourceColumn + row);

  const formula = cell.getFormula();

  let  testUrl = extractUrlFromFormula(formula);


  if (!testUrl) {

   const rtv = cell.getRichTextValue();

   if (rtv) testUrl = rtv.getLinkUrl();

  }


  if (!testUrl) {

   Logger.log(`No URL found at row ${row} — skipping`);

   continue;

  }


  Logger.log(`Processing row ${row}: ${testUrl}`);


  try {

   // ── Step 1: fetch the ftr:Test DCAT record ──────────────────────────

   const testRdf = fetchUrl(testUrl);

   Logger.log(`Fetched ${testRdf.length} chars from ${testUrl}`);


   const testDescription = extractDctermsDescription(testRdf);

   Logger.log(`Description: ${testDescription ? testDescription.substring(0, 80) + '…' : 'not found'}`);


   const metricUrls = findSIO000233Objects(testRdf);

   Logger.log(`SIO_000233 metric URLs: ${metricUrls.length}`);


   // ── Step 2: fetch each Metric DCAT record for dcterms:title ────────

   const metricNames = metricUrls.map(metricUrl => {

    try {

     Logger.log(`Fetching metric record: ${metricUrl}`);

     const metricRdf = fetchUrl(metricUrl);

     const title   = extractDctermsTitle(metricRdf);

     if (title) {

      Logger.log(`Metric title: ${title}`);

      return title;

     }

     // Fallback: rdfs:label if dcterms:title is absent.

     const label = extractRdfsLabel(metricRdf, metricUrl);

     return label || metricUrl;

    } catch (metricErr) {

     Logger.log(`Error fetching metric <${metricUrl}>: ${metricErr.message}`);

     return metricUrl; // degrade gracefully

    }

   });


   data.push({

    metricNames:   metricNames.join('; ') || 'N/A',

    metricUrls:   metricUrls.join('; ')  || 'N/A',

    testUrl:     testUrl,

    testDescription: testDescription     || 'N/A',

   });


  } catch (err) {

   Logger.log(`Error processing row ${row}: ${err.message}`);

   data.push({

    metricNames:   'Error',

    metricUrls:   'Error',

    testUrl:     testUrl,

    testDescription: err.message,

   });

  }


  Utilities.sleep(CONFIG.requestDelayMs);

 }


 return data;

}


// ── RDF parsing helpers ───────────────────────────────────────────────────────


/**

 * Finds all object URIs of sio:SIO_000233 / <…SIO_000233> triples.

 *

 * The OSTrails registry serialises predicates as full URIs, so the primary

 * pattern matches <http://semanticscience.org/resource/SIO_000233>.

 * The prefixed form (sio:SIO_000233) is checked as a fallback.

 *

 * No type-filtering is applied: the objects are URIs of Metric DCAT records

 * in separate documents, so they will not have a dqv:Metric type declaration

 * in the same Test document.

 *

 * @param {string}  content Raw Turtle text of the ftr:Test record.

 * @returns {string[]}     Array of metric URI strings (may be empty).

 */

function findSIO000233Objects(content) {

 const patterns = [

  // Full URI form — primary (as served by tests.ostrails.eu).

  /<http:\/\/semanticscience\.org\/resource\/SIO_000233>\s+<([^>]+)>/g,

  // Prefixed form — fallback.

  /sio:SIO_000233\s+<([^>]+)>/g,

 ];


 const results = [];

 for (const pat of patterns) {

  let m;

  while ((m = pat.exec(content)) !== null) {

   if (!results.includes(m[1])) results.push(m[1]);

  }

 }

 Logger.log(`SIO_000233 objects found: ${results.join(', ')}`);

 return results;

}


/**

 * Extracts the dcterms:description literal from a Turtle document.

 *

 * Handles:

 *  - Full URI predicate: <http://purl.org/dc/terms/description>

 *  - Prefixed predicate: dcterms:description

 *  - Language-tagged literals: "…"@en

 *  - Triple-quoted literals: """…"""

 *  - Datatype-tagged literals: "…"^^xsd:string

 *  - XML/RDF serialisation fallback

 *

 * @param {string}   content Raw Turtle text.

 * @returns {string|null}     Trimmed description, or null if not found.

 */

function extractDctermsDescription(content) {

 const predicatePatterns = [

  // Full URI — primary.

  /<http:\/\/purl\.org\/dc\/terms\/description>/,

  // Prefixed — fallback.

  /dcterms:description/,

 ];


 for (const predPat of predicatePatterns) {

  // Triple-quoted literal.

  const tripleQ = new RegExp(predPat.source + '\\s+"""([\\s\\S]*?)"""');

  let m = content.match(tripleQ);

  if (m) { Logger.log('Description: full-URI triple-quoted'); return m[1].trim(); }


  // Single-quoted literal — language tag or datatype tag variant.

  const singleQ = new RegExp(predPat.source + '\\s+"((?:[^"\\\\]|\\\\.)*)"');

  m = content.match(singleQ);

  if (m) { Logger.log('Description: full-URI single-quoted'); return m[1].trim(); }

 }


 // XML/RDF fallback.

 for (const pat of [

  /<dcterms:description[^>]*>([\s\S]*?)<\/dcterms:description>/i,

  /<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i,

 ]) {

  const m = content.match(pat);

  if (m) {

   Logger.log('Description: XML/RDF serialisation');

   return m[1].trim().replace(/<[^>]*>/g, '');

  }

 }


 Logger.log('Description not found');

 return null;

}


/**

 * Extracts the dcterms:title literal from a Metric DCAT Turtle document.

 *

 * Handles full-URI and prefixed predicate forms, language tags, datatype tags,

 * and both triple-quoted and single-quoted literals.

 *

 * @param {string}   content Raw Turtle text of the dqv:Metric record.

 * @returns {string|null}     Trimmed title, or null if not found.

 */

function extractDctermsTitle(content) {

 const predicatePatterns = [

  /<http:\/\/purl\.org\/dc\/terms\/title>/,

  /dcterms:title/,

 ];


 for (const predPat of predicatePatterns) {

  const tripleQ = new RegExp(predPat.source + '\\s+"""([\\s\\S]*?)"""');

  let m = content.match(tripleQ);

  if (m) { Logger.log('Title: triple-quoted'); return m[1].trim(); }


  const singleQ = new RegExp(predPat.source + '\\s+"((?:[^"\\\\]|\\\\.)*)"');

  m = content.match(singleQ);

  if (m) { Logger.log('Title: single-quoted'); return m[1].trim(); }

 }


 Logger.log('dcterms:title not found');

 return null;

}


/**

 * Extracts the rdfs:label literal for a specific URI from a Turtle document.

 * Used as a fallback when dcterms:title is absent.

 *

 * @param {string}   content Raw Turtle text.

 * @param {string}   uri   URI of the resource (without angle brackets).

 * @returns {string|null}     Label string, or null if not found.

 */

function extractRdfsLabel(content, uri) {

 const escaped = uri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');


 // Locate the subject block for this URI.

 const blockPattern = new RegExp(`<${escaped}>[\\s\\S]*?\\.(?=\\s*(?:<|@prefix|$))`);

 const blockMatch  = content.match(blockPattern);

 const block    = blockMatch ? blockMatch[0] : content;


 const predicatePatterns = [

  /<http:\/\/www\.w3\.org\/2000\/01\/rdf-schema#label>/,

  /rdfs:label/,

 ];


 for (const predPat of predicatePatterns) {

  const tripleQ = new RegExp(predPat.source + '\\s+"""([\\s\\S]*?)"""');

  let m = block.match(tripleQ);

  if (m) return m[1].trim();


  const singleQ = new RegExp(predPat.source + '\\s+"((?:[^"\\\\]|\\\\.)*)"');

  m = block.match(singleQ);

  if (m) return m[1].trim();

 }


 Logger.log(`No rdfs:label found for <${uri}>`);

 return null;

}


// ── URL / formula helpers ─────────────────────────────────────────────────────


/**

 * Extracts the URL argument from a Sheets HYPERLINK formula.

 *

 * @param {string}   formula Cell formula string (may be empty).

 * @returns {string|null}     The URL, or null if not a HYPERLINK formula.

 */

function extractUrlFromFormula(formula) {

 if (!formula) return null;

 const m = formula.match(/HYPERLINK\s*\(\s*"([^"]+)"/i);

 return m ? m[1] : null;

}


/**

 * Fetches the content of a URL and returns the response body as a string.

 * Always requests Turtle RDF via content negotiation — every URL in this

 * script may be served by a different host, and not all of them default to

 * Turtle without an explicit Accept header.

 *

 * @param {string} url The URL to fetch.

 * @returns {string}   Response body text.

 * @throws {Error}   On non-200 responses or network failures.

 */

function fetchUrl(url) {

 const response = UrlFetchApp.fetch(url, {

  muteHttpExceptions: true,

  followRedirects:  true,

  headers: {

   'Accept': 'text/turtle, application/ld+json;q=0.9, */*;q=0.5',

  },

 });

 const code = response.getResponseCode();

 if (code === 200) return response.getContentText();

 throw new Error(`HTTP ${code} fetching ${url}`);

}


// ── Sheet helpers ─────────────────────────────────────────────────────────────




/**

 * Returns an existing sheet by name, or creates it if absent.

 * If the sheet already exists its content is cleared before being returned.

 *

 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} spreadsheet

 * @param {string}                  sheetName

 * @returns {GoogleAppsScript.Spreadsheet.Sheet}

 */

function getOrCreateSheet(spreadsheet, sheetName) {

 let sheet = spreadsheet.getSheetByName(sheetName);

 if (!sheet) {

  sheet = spreadsheet.insertSheet(sheetName);

  Logger.log(`Created sheet: ${sheetName}`);

 } else {

  sheet.clear();

  Logger.log(`Cleared sheet: ${sheetName}`);

 }

 return sheet;

}


/**

 * Writes the report header row and data rows to the target sheet, then

 * auto-resizes all columns for readability.

 *

 * Data is written in a single setValues() call to minimise API round-trips.

 *

 * @param {GoogleAppsScript.Spreadsheet.Sheet}            sheet Target sheet.

 * @param {{ metricNames: string, metricUrls: string,

 *      testUrl: string, testDescription: string }[]}      data  Report rows.

 */

function writeReport(sheet, data) {

 const headers   = ['Metric name(s)', 'Metric URL(s)', 'Test URL', 'Test description'];

 const headerRange = sheet.getRange(1, 1, 1, headers.length);

 headerRange.setValues([headers]);

 headerRange.setFontWeight('bold');


 if (data.length > 0) {

  const rows = data.map(item => [

   item.metricNames,

   item.metricUrls,

   item.testUrl,

   item.testDescription,

  ]);

  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

 }


 sheet.autoResizeColumns(1, headers.length);

 Logger.log(`Report written: ${data.length} data rows`);

}


// ── Debug helpers ─────────────────────────────────────────────────────────────


/**

 * Logs the value, formula, and rich-text link URL for the first 20 rows of

 * the source column. Run manually from the Apps Script editor to diagnose

 * cell content issues without triggering the full report generation.

 */

function debugSourceColumn() {

 const ss  = SpreadsheetApp.getActiveSpreadsheet();

 const sheet = ss.getSheetByName(CONFIG.sourceSheetName);


 if (!sheet) {

  Logger.log(`Sheet "${CONFIG.sourceSheetName}" not found`);

  return;

 }


 const limit = Math.min(20, sheet.getLastRow());

 Logger.log(`Inspecting first ${limit} rows of column ${CONFIG.sourceColumn}:`);


 for (let i = 1; i <= limit; i++) {

  const cell = sheet.getRange(CONFIG.sourceColumn + i);

  const rtv = cell.getRichTextValue();

  Logger.log(

   `Row ${i}: value="${cell.getValue()}" formula="${cell.getFormula()}" link="${rtv ? rtv.getLinkUrl() : ''}"`,

  );

 }

}


/**

 * Debug helper: fetches a single Test URL and logs the raw Turtle content,

 * the extracted SIO_000233 metric URLs, description, and — for each metric URL

 * — the fetched title. Run manually to verify the two-step resolution chain

 * without processing the entire sheet.

 *

 * Edit DEBUG_TEST_URL below to point at any test record.

 */

function debugSingleTest() {

 const DEBUG_TEST_URL = 'https://tests.ostrails.eu/tests/fc_metadata_protocol';


 Logger.log(`=== debugSingleTest: ${DEBUG_TEST_URL} ===`);


 const testRdf = fetchUrl(DEBUG_TEST_URL);

 Logger.log(`--- Raw Turtle (first 500 chars) ---\n${testRdf.substring(0, 500)}`);


 const description = extractDctermsDescription(testRdf);

 Logger.log(`Description: ${description}`);


 const metricUrls = findSIO000233Objects(testRdf);

 Logger.log(`Metric URLs: ${JSON.stringify(metricUrls)}`);


 for (const metricUrl of metricUrls) {

  Logger.log(`Fetching metric: ${metricUrl}`);

  try {

   const metricRdf = fetchUrl(metricUrl);

   Logger.log(`Metric Turtle (first 300 chars):\n${metricRdf.substring(0, 300)}`);

   const title = extractDctermsTitle(metricRdf);

   Logger.log(`Title: ${title}`);

  } catch (e) {

   Logger.log(`Error: ${e.message}`);

  }

 }

}
