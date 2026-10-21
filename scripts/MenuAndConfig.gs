/**
 * @file MenuAndConfig.gs
 * Adds a custom "FAIR Metrics" menu to the Spreadsheet UI when
 * the file is opened. Runs automatically; do not call manually.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('FAIR Metrics')
    .addItem('Validate Test References', 'validateTestReferences')
    .addItem('Validate Guidance URLs',   'validateGuidanceUrls')
    .addItem('Generate Report', 'generateFAIRMetricsReport')
    .addToUi();
}

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * Central configuration object. Edit these values to adapt the script to a
 * differently structured spreadsheet without touching any logic below.
 *
 * @property {string} sourceSheetName      Name of the sheet that contains the data.
 * @property {string} targetSheetName      Name of the sheet used for report output
 *                                         (reserved for future use).
 * @property {string} sourceColumn         Column letter whose cells contain the
 *                                         start/stop marker text.
 * @property {string} startMarker          Cell text that marks the row after which
 *                                         token scanning begins.
 * @property {string} stopMarker           Cell text that marks the end of the token
 *                                         block and the start of the expression block
 * @property {number} requestDelayMs       Milliseconds to pause between HTTP requests to avoid
 *                                         rate-limiting. Increase if you see HTTP 429 responses.
 * @property {number} maxConsecutiveEmpty  Number of consecutive empty cells that signals the
 *                                         end of the hyperlink block (as a fallback when
 *                                         stopMarker is absent).
 */
const CONFIG = {
  sourceSheetName: 'Algorithm',
  targetSheetName: 'Description',
  sourceColumn:    'B',
  startMarker:     'Test GUID',
  stopMarker:      'Description',
  requestDelayMs:      1000,
  maxConsecutiveEmpty: 3,
  metricNameJsonPath: 'metadata.name',
  fetchFailures: []
};


/** SHARED HELPER FUNCTION
 * 
 * Returns the first row number (1-based) that should be scanned for tokens —
 * i.e. the row immediately after the startMarker row — by searching the
 * pre-read sourceColValues array.
 *
 * Using a pre-read array instead of per-cell getRange().getValue() calls avoids
 * O(n) API round-trips.
 *
 * @param  {string[]} sourceColValues  All values from the sourceColumn, index 0 = row 1.
 * @returns {number|null}              1-based row number after the marker, or null if not found.
 */
function findStartRowFromArray(sourceColValues) {
  for (let i = 0; i < sourceColValues.length; i++) {
    if (sourceColValues[i].trim() === CONFIG.startMarker) {
      Logger.log(`Found "${CONFIG.startMarker}" at row ${i + 1}`);
      return i + 2; // Convert 0-based index to 1-based row, then advance by 1.
    }
  }
  Logger.log(`"${CONFIG.startMarker}" not found`);
  return null;
}
