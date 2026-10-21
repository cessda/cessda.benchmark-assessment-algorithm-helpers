/**
 * Check that the URLs in the Guidance column (F) are all accessible for each
 * row in the Condition region (stopMarker + 1 to first empty row in column C).
 * 
 * Flags:
 *  - Rows with a non-empty Condition (col C) but empty Guidance (col F)
 *  - Guidance URLs that return a non-2xx/3xx HTTP response
 *  - Guidance URLs that fail to fetch entirely
 */
function validateGuidanceUrls() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName(CONFIG.sourceSheetName);

  if (!sourceSheet) {
    SpreadsheetApp.getUi().alert(`Error: Sheet "${CONFIG.sourceSheetName}" not found`);
    return;
  }

  // ── Column letters ────────────────────────────────────────────────────────
  const sourceColIndex   = columnLetterToIndex(CONFIG.sourceColumn); // B → 2
  const conditionColLetter = indexToColumnLetter(sourceColIndex + 1); // C
  const guidanceColLetter  = 'F';

  // ── Find stopMarker row ───────────────────────────────────────────────────
  const maxRows = sourceSheet.getLastRow();
  let stopMarkerRow = null;

  for (let row = 1; row <= maxRows; row++) {
    const val = sheet_getValue(sourceSheet, CONFIG.sourceColumn, row);
    if (val && val.toString().trim() === CONFIG.stopMarker) {
      stopMarkerRow = row;
      break;
    }
  }

  if (stopMarkerRow === null) {
    SpreadsheetApp.getUi().alert(
      `Error: stopMarker "${CONFIG.stopMarker}" not found in column ${CONFIG.sourceColumn}`
    );
    return;
  }

  Logger.log(`Condition region starts at row ${stopMarkerRow + 1}`);

  // ── Collect rows to check ─────────────────────────────────────────────────
  // Region runs from stopMarkerRow + 1 to the first empty cell in column C.
  const checkStartRow = stopMarkerRow + 1;
  const rowsToCheck   = []; // { row, conditionVal, guidanceVal }
  let   consecutiveEmpty = 0;

  for (let row = checkStartRow; row <= maxRows; row++) {
    const condVal = sheet_getValue(sourceSheet, conditionColLetter, row);

    if (!condVal || condVal.toString().trim() === '') {
      consecutiveEmpty++;
      Logger.log(`Empty condition cell at row ${row} (${consecutiveEmpty} consecutive)`);
      if (consecutiveEmpty >= CONFIG.maxConsecutiveEmpty) {
        Logger.log(`${CONFIG.maxConsecutiveEmpty} consecutive empty condition cells — stopping`);
        break;
      }
      continue;
    }

    consecutiveEmpty = 0;

    const guidanceVal = sheet_getValue(sourceSheet, guidanceColLetter, row);
    rowsToCheck.push({
      row,
      conditionVal: condVal.toString().trim(),
      guidanceVal:  guidanceVal ? guidanceVal.toString().trim() : ''
    });

    Logger.log(`Row ${row}: condition="${condVal}", guidance="${guidanceVal}"`);
  }

  Logger.log(`Total rows to check: ${rowsToCheck.length}`);

  if (rowsToCheck.length === 0) {
    SpreadsheetApp.getUi().alert('No condition rows found in the check region — nothing to validate.');
    return;
  }

  // ── Check each row ────────────────────────────────────────────────────────
  const missingGuidance    = []; // { row, conditionVal }
  const inaccessibleUrls   = []; // { row, url, reason }

  for (const { row, conditionVal, guidanceVal } of rowsToCheck) {

    // Flag missing guidance where a URL is expected
    if (!guidanceVal) {
      missingGuidance.push({ row, conditionVal });
      Logger.log(`Row ${row}: missing guidance URL (condition: "${conditionVal}")`);
      continue;
    }

    // Parse guidance cell — format is [[url1,"desc1"],[url2,"desc2"],...]
    // URLs are unquoted so JSON.parse is not reliable; extract with regex instead.
    const urlPattern = /\[\s*(https?:\/\/[^,\]]+?)\s*,/g;
    const guidanceUrls = [];
    let match;

    while ((match = urlPattern.exec(guidanceVal)) !== null) {
      guidanceUrls.push(match[1].trim());
    }

    // If no URLs were parsed, treat the raw value as a single URL fallback
    if (guidanceUrls.length === 0 && /^https?:\/\//i.test(guidanceVal)) {
      guidanceUrls.push(guidanceVal);
    }

    if (guidanceUrls.length === 0) {
      inaccessibleUrls.push({ row, url: guidanceVal, reason: 'Could not parse guidance URL(s)' });
      Logger.log(`Row ${row}: could not parse any URLs from "${guidanceVal}"`);
      continue;
    }

    // Check each URL
    for (const url of guidanceUrls) {
      Logger.log(`Row ${row}: checking "${url}"`);

      try {
        const response = UrlFetchApp.fetch(url, {
          muteHttpExceptions: true,
          followRedirects:    true
        });
        const code = response.getResponseCode();

        if (code < 200 || code >= 400) {
          inaccessibleUrls.push({ row, url, reason: `HTTP ${code}` });
          Logger.log(`Row ${row}: "${url}" returned HTTP ${code}`);
        } else {
          Logger.log(`Row ${row}: "${url}" OK (HTTP ${code})`);
        }
      } catch (error) {
        inaccessibleUrls.push({ row, url, reason: error.message });
        Logger.log(`Row ${row}: fetch error for "${url}": ${error.message}`);
      }

      Utilities.sleep(CONFIG.requestDelayMs);
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  Logger.log(`Missing guidance: ${missingGuidance.length}, Inaccessible URLs: ${inaccessibleUrls.length}`);

  if (missingGuidance.length === 0 && inaccessibleUrls.length === 0) {
    SpreadsheetApp.getUi().alert(
      `✅ All ${rowsToCheck.length} guidance URL(s) are present and accessible.`
    );
    return;
  }

  const lines = [];

  if (missingGuidance.length > 0) {
    lines.push(`${missingGuidance.length} row(s) with a condition but no guidance URL:\n`);
    for (const { row, conditionVal } of missingGuidance) {
      lines.push(`  • Row ${row}: condition "${conditionVal}"`);
    }
  }

  if (inaccessibleUrls.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(`${inaccessibleUrls.length} guidance URL(s) that are not accessible:\n`);
    for (const { row, url, reason } of inaccessibleUrls) {
      lines.push(`  • Row ${row}: ${reason}\n    ${url}`);
    }
  }

  lines.push(`\nChecked ${rowsToCheck.length} row(s) in the condition region.`);

  const summary = lines.join('\n');
  Logger.log(summary);
  SpreadsheetApp.getUi().alert(summary);
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Read a cell value using a column letter and a numeric row.
 */
function sheet_getValue(sheet, colLetter, row) {
  return sheet.getRange(colLetter + row).getValue();
}
