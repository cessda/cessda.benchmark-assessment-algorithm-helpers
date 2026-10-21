/**
 * @file ValidateTestReferences.gs
 * @description Google Apps Script for validating FAIR Metric test references in a
 *   Google Spreadsheet. Reads declared tokens from a "reference" column, reads
 *   boolean expressions from a "check" column, then cross-validates that:
 *     1. Every declared token appears in at least one expression.
 *     2. Every token used inside an expression has been declared.
 *     3. All tokens (declared and in-expression) contain only permitted characters.
 *     4. No declared token has leading or trailing whitespace.
 *     5. Every Test GUID hyperlink URL returns an HTTP status code < 400
 *
 *   Sheet layout expected in CONFIG.sourceSheetName (default: "Algorithm")
 *   as defined in MenuAndConfig.gs file:
 *
 *     Column A (refCol)    - Test Reference tokens (one per row)
 *     Column B (sourceCol) - marker cells: "Test GUID" marks the start of the token
 *                            block; "Description" marks its end and the start of the
 *                            expression block
 *     Column C (checkCol)  - Boolean expressions referencing the tokens above
 *
 *   The script is triggered via Extensions → Apps Script, or via the custom
 *   "FAIR Metrics" menu added by onOpen().
 *
 * Algorithm overview
 * ------------------
 * Phase 1 - Bulk-read the source sheet into memory (one API call per column).
 * Phase 2 - Collect declared tokens from the reference column (A) between the
 *            startMarker row and the stopMarker row.
 * Phase 3 - Guard checks:
 *   3a. Invalid characters in declared tokens.
 *   3b. Leading/trailing spaces in declared tokens.
 *   3c. Invalid characters in condition tokens below the stopMarker.
 *   3d. Each Test GUID hyperlink URL is fetched and checked for sub 400 status code.
 * Phase 4 - Collect expressions from the check column (C) below the stopMarker.
 * Phase 5 - Cross-validate: find declared tokens absent from all expressions,
 *            and expression tokens that have never been declared.
 * Phase 6 - Report results via the Spreadsheet UI.
 *
 * Performance note: All cell reads are batched into a small number of
 * getValues() calls rather than per-cell getValue() calls, which is critical
 * for sheets with many rows because each Apps Script service call carries
 * significant latency overhead.
 */

function validateTestReferences() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sourceSheet = ss.getSheetByName(CONFIG.sourceSheetName);

  if (!sourceSheet) {
    alertAndReturn(`Error: Sheet "${CONFIG.sourceSheetName}" not found`);
    return;
  }

  const sourceColIndex = columnLetterToIndex(CONFIG.sourceColumn);
  const refColIndex = sourceColIndex - 1;
  const checkColIndex = sourceColIndex + 1;

  const refColLetter = indexToColumnLetter(refColIndex);
  const checkColLetter = indexToColumnLetter(checkColIndex);

  const INVALID_TOKEN_CHARS = new RegExp(`[^A-Za-z0-9_]`);
  const SPLIT_ON_NON_TOKEN = new RegExp(`[^A-Za-z0-9_]+`);

  const maxRows = sourceSheet.getLastRow();

  const sourceColValues = sourceSheet
    .getRange(`${CONFIG.sourceColumn}1:${CONFIG.sourceColumn}${maxRows}`)
    .getValues()
    .map(r => (r[0] || '').toString());

  const refColValues = sourceSheet
    .getRange(`${refColLetter}1:${refColLetter}${maxRows}`)
    .getValues()
    .map(r => (r[0] || '').toString());

  const checkColValues = sourceSheet
    .getRange(`${checkColLetter}1:${checkColLetter}${maxRows}`)
    .getValues()
    .map(r => (r[0] || '').toString());

  const startRow = findStartRowFromArray(sourceColValues);
  if (!startRow) {
    alertAndReturn(`Error: "${CONFIG.startMarker}" not found`);
    return;
  }

  const tokens = [];
  const tokenSet = new Set();
  let stopMarkerRow = null;

  // ─────────────────────────────────────────────
  // Collect tokens
  // ─────────────────────────────────────────────
  for (let row = startRow; row <= maxRows; row++) {
    const marker = sourceColValues[row - 1].trim();

    if (marker === CONFIG.stopMarker) {
      stopMarkerRow = row;
      break;
    }

    const raw = refColValues[row - 1].trim();
    if (raw) {
      tokens.push({ token: raw, row });
      tokenSet.add(raw);
    }
  }

  const checkStartRow = stopMarkerRow ? stopMarkerRow + 1 : startRow;

  // ─────────────────────────────────────────────
  // Phase 3a - Invalid characters in declared tokens
  // ─────────────────────────────────────────────
  const invalidCharTokens = collectInvalidCharTokens(tokens, INVALID_TOKEN_CHARS);

  if (invalidCharTokens.size > 0) {
    const lines = [`${invalidCharTokens.size} declared token(s) contain invalid characters:\n`];
    for (const [t, rows] of invalidCharTokens) {
      lines.push(`  • "${t}" (row ${rows.join(', ')})`);
    }
    alertAndReturn(lines.join('\n'));
    return;
  }

  // ─────────────────────────────────────────────
  // Phase 3b - Leading/trailing whitespace in declared tokens
  // ─────────────────────────────────────────────
  // Note: tokens were pushed using raw = refColValues[row-1].trim(), so we need
  // to re-read the raw (untrimmed) value to catch whitespace violations.
  const whitespaceTokens = new Map();
  for (let row = startRow; row <= (stopMarkerRow ?? maxRows); row++) {
    const raw = refColValues[row - 1]; // intentionally NOT trimmed
    const marker = sourceColValues[row - 1].trim();
    if (marker === CONFIG.stopMarker) break;
    if (raw !== raw.trim() && raw.trim()) {
      if (!whitespaceTokens.has(raw)) whitespaceTokens.set(raw, []);
      whitespaceTokens.get(raw).push(row);
    }
  }

  if (whitespaceTokens.size > 0) {
    const lines = [`${whitespaceTokens.size} declared token(s) have leading/trailing whitespace:\n`];
    for (const [t, rows] of whitespaceTokens) {
      lines.push(`  • "${t}" (row ${rows.join(', ')})`);
    }
    alertAndReturn(lines.join('\n'));
    return;
  }

  // ─────────────────────────────────────────────
  // Phase 3c - Invalid characters in expression tokens
  // ─────────────────────────────────────────────
  const invalidExprTokens = new Map();
  for (let row = checkStartRow; row <= maxRows; row++) {
    const val = checkColValues[row - 1].trim();
    if (!val) break;
    const fragments = val.split(SPLIT_ON_NON_TOKEN).filter(f => f && !/^\d+$/.test(f));
    for (const f of fragments) {
      if (INVALID_TOKEN_CHARS.test(f)) {
        if (!invalidExprTokens.has(f)) invalidExprTokens.set(f, []);
        invalidExprTokens.get(f).push(row);
      }
    }
  }

  if (invalidExprTokens.size > 0) {
    const lines = [`${invalidExprTokens.size} expression token(s) contain invalid characters:\n`];
    for (const [t, rows] of invalidExprTokens) {
      lines.push(`  • "${t}" (row ${rows.join(', ')})`);
    }
    alertAndReturn(lines.join('\n'));
    return;
  }

  // ─────────────────────────────────────────────
  // Phase 3d INIT (IMPORTANT FIX)
  // ─────────────────────────────────────────────
  CONFIG.fetchFailures = []; // reset each run

  // ─────────────────────────────────────────────
  // URL VALIDATION HELPERS
  // ─────────────────────────────────────────────
  function extractUrl(row) {
    const cell = sourceSheet.getRange(CONFIG.sourceColumn + row);

    const formula = cell.getFormula();
    let url = extractUrlFromFormula(formula);

    if (!url) {
      const rtv = cell.getRichTextValue();
      if (rtv) url = rtv.getLinkUrl();
    }

    return url;
  }

  function checkUrlFetchable(row, url) {
    if (!url) return;

    try {
      const res = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true
      });

      const status = res.getResponseCode();

      if (status >= 400) {
        CONFIG.fetchFailures.push({
          row,
          url,
          reason: `HTTP ${status}`
        });
      }
    } catch (err) {
      CONFIG.fetchFailures.push({
        row,
        url,
        reason: `Fetch failed: ${err.message}`
      });
    }
  }

  // ── Phase 3d: URL VALIDATION (PARALLEL) ────────────────────────────────

  const sioScanEndRow = stopMarkerRow ? stopMarkerRow - 1 : maxRows;

  CONFIG.fetchFailures = [];

  const requests = [];
  const rowMap = []; // maps request index → row
  let urlCount = 0;

  // Collect all URLs first (no fetching yet)
  for (let row = startRow; row <= sioScanEndRow; row++) {
    const url = extractUrl(row);
    if (!url) continue;

    urlCount++;

    requests.push({
      url,
      muteHttpExceptions: true,
      followRedirects: true
    });

    rowMap.push(row);
  }

  Logger.log(`Phase 3d: collected ${urlCount} URLs for validation`);

  // ── Fetch in batches (UrlFetchApp limit-safe) ───────────────────────────
  const BATCH_SIZE = 20;

  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    const batch = requests.slice(i, i + BATCH_SIZE);
    const batchRows = rowMap.slice(i, i + BATCH_SIZE);

    let responses;

    try {
      responses = UrlFetchApp.fetchAll(batch);
    } catch (err) {
      // If fetchAll fails entirely, degrade to per-request logging
      for (let j = 0; j < batch.length; j++) {
        CONFIG.fetchFailures.push({
          row: batchRows[j],
          url: batch[j].url,
          reason: `Batch fetchAll failed: ${err.message}`
        });
      }
      continue;
    }

    // Evaluate responses
    for (let j = 0; j < responses.length; j++) {
      const res = responses[j];
      const status = res.getResponseCode();
      const row = batchRows[j];
      const url = batch[j].url;

      if (status >= 400) {
        CONFIG.fetchFailures.push({
          row,
          url,
          reason: `HTTP ${status}`
        });
      }
    }
  }

  Logger.log(`Phase 3d: fetch failures = ${CONFIG.fetchFailures.length}`);


  // ─────────────────────────────────────────────
  // Collect expressions
  // ─────────────────────────────────────────────
  const expressions = [];

  for (let row = checkStartRow; row <= maxRows; row++) {
    const val = checkColValues[row - 1].trim();
    if (!val) break;

    expressions.push({ expr: val, row });
  }

  // ─────────────────────────────────────────────
  // Token usage analysis
  // ─────────────────────────────────────────────
  const tokensInExpressions = new Set();
  const expressionRows = new Map();

  for (const { expr, row } of expressions) {
    const fragments = expr
      .split(SPLIT_ON_NON_TOKEN)
      .filter(f => f && !/^\d+$/.test(f));

    for (const f of fragments) {
      tokensInExpressions.add(f);
      if (!expressionRows.has(f)) expressionRows.set(f, []);
      expressionRows.get(f).push(row);
    }
  }

  const missingFromExpressions = new Map();
  for (const { token, row } of tokens) {
    if (!tokensInExpressions.has(token)) {
      if (!missingFromExpressions.has(token)) {
        missingFromExpressions.set(token, []);
      }
      missingFromExpressions.get(token).push(row);
    }
  }

  const undeclaredInExpressions = new Map();
  for (const [frag, rows] of expressionRows.entries()) {
    if (!tokenSet.has(frag)) {
      undeclaredInExpressions.set(frag, rows);
    }
  }

  // ─────────────────────────────────────────────
  // FINAL REPORT
  // ─────────────────────────────────────────────
  const lines = [];

  if (missingFromExpressions.size > 0) {
    lines.push(
      `${missingFromExpressions.size} tokens missing from expressions:\n`
    );

    for (const [t, rows] of missingFromExpressions) {
      lines.push(`  • ${t} (row ${rows.join(', ')})`);
    }
  }

  if (undeclaredInExpressions.size > 0) {
    if (lines.length) lines.push('');

    lines.push(
      `${undeclaredInExpressions.size} undeclared tokens in expressions:\n`
    );

    for (const [t, rows] of undeclaredInExpressions) {
      lines.push(`  • ${t} (row ${rows.join(', ')})`);
    }
  }

  if (CONFIG.fetchFailures.length > 0) {
    if (lines.length) lines.push('');

    lines.push(
      `${CONFIG.fetchFailures.length} / ${urlCount} Test GUID URL(s) failed HTTP validation:\n`
    );

    for (const failure of CONFIG.fetchFailures) {
      lines.push(`  • Row ${failure.row}: ${failure.url}`);
      lines.push(`    ↳ ${failure.reason}`);
    }
  }

  lines.push(
    `\nChecked ${tokens.length} tokens, ${expressions.length} expressions and ${urlCount} Test GUIDs`
  );

  SpreadsheetApp.getUi().alert(lines.join('\n'));
}

// ─────────────────────────────────────────────
// Helper (unchanged)
// ─────────────────────────────────────────────
function alertAndReturn(msg) {
  SpreadsheetApp.getUi().alert(msg);
}


/**
 * Scans an array of { token, row } objects and returns a Map of tokens that
 * contain at least one character outside the permitted character class.
 *
 * @param  {{ token: string, row: number }[]} tokens           Declared token list.
 * @param  {RegExp}                           invalidCharRegex  Regex that matches a single invalid character.
 * @returns {Map<string, number[]>}           Map from invalid token string to the rows where it appears.
 */
function collectInvalidCharTokens(tokens, invalidCharRegex) {
  const result = new Map();
  for (const { token, row } of tokens) {
    if (invalidCharRegex.test(token)) {
      if (!result.has(token)) result.set(token, []);
      result.get(token).push(row);
    }
  }
  return result;
}

/**
 * Displays an alert and immediately returns from the caller. Because Apps
 * Script does not support throwing to unwind multiple stack frames, callers
 * must still issue their own `return` after calling this helper — this
 * function exists purely to deduplicate the alert line.
 *
 * @param {string} message  The message to display in the UI alert dialog.
 */
function alertAndReturn(message) {
  SpreadsheetApp.getUi().alert(message);
}

/**
 * Converts a column letter (or multi-letter label) to a 1-based column index.
 * Examples: "A" → 1, "B" → 2, "Z" → 26, "AA" → 27.
 *
 * @param  {string} letter  Column label (case-insensitive).
 * @returns {number}        1-based column index.
 */
function columnLetterToIndex(letter) {
  return letter.toUpperCase().split('').reduce((acc, ch) => {
    return acc * 26 + (ch.charCodeAt(0) - 64);
  }, 0);
}

/**
 * Converts a 1-based column index to its spreadsheet column letter(s).
 * Examples: 1 → "A", 26 → "Z", 27 → "AA", 28 → "AB".
 *
 * @param  {number} index  1-based column index.
 * @returns {string}       Column label (upper-case).
 */
function indexToColumnLetter(index) {
  let letter = '';
  while (index > 0) {
    const remainder = (index - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    index = Math.floor((index - 1) / 26);
  }
  return letter;
}
