# ValidateTestReferences.gs

`ValidateTestReferences.gs` provides the **FAIR Metrics > Validate Test
References** menu item. It checks that the test reference tokens declared in
the algorithm and the tokens used in its Boolean condition expressions agree
with each other, and that every Test GUID link works.

It also holds general-purpose helper functions used by other scripts.

## What it checks

| Check | Stops the run on failure |
| --- | --- |
| Declared tokens contain only letters, digits and underscores | Yes |
| Declared tokens have no leading or trailing whitespace | Yes |
| Tokens in expressions contain only permitted characters | Yes |
| Every Test GUID hyperlink returns an HTTP status below 400 | No |
| Every declared token is used in at least one expression | No |
| Every token used in an expression has been declared | No |

The first three checks are guards. If one fails, the problem is shown and the
script stops, because later results would be unreliable. The remaining checks
are reported together in a single summary.

## Running the check

1. Open the spreadsheet and wait for the **FAIR Metrics** menu to appear.
2. Choose **FAIR Metrics > Validate Test References**.
3. Wait for the results dialogue.

The dialogue lists any problems with their row numbers. It always ends with a
count of the tokens, expressions and Test GUIDs checked.

## Sheet layout

The script reads three columns of the source sheet. Column letters are
derived from `CONFIG.sourceColumn` in [MenuAndConfig.gs](menu-and-config.md).

| Column | Role |
| --- | --- |
| A | Declared tokens, one per row (the column before the source one) |
| B | Markers and Test GUID hyperlinks (the source column) |
| C | Boolean expressions (the column after the source one) |

- Tokens are read from column A between the `Test GUID` marker row and the
  `Description` marker row.
- Expressions are read from column C, starting on the row after the
  `Description` marker, and end at the first empty cell.

### Token rules

A token may contain only the characters `A-Z`, `a-z`, `0-9` and `_`. When
expressions are split into tokens, anything else (operators, brackets and
spaces) acts as a separator, and purely numeric fragments are ignored.

## How it works

1. **Bulk read.** The script reads columns A, B and C in three calls, rather
   than one call per cell, which keeps it fast on large sheets.
2. **Collect tokens.** Declared tokens are gathered up to the stop marker.
3. **Guard checks.** Invalid characters in declared tokens, whitespace in
   declared tokens, and invalid characters in expression tokens.
4. **URL validation.** Each Test GUID hyperlink is read from the cell formula
   (`HYPERLINK`) or, failing that, from the rich-text link. The URLs are
   fetched in batches of 20 with `UrlFetchApp.fetchAll`, and any status of 400
   or above is recorded. If a whole batch fails, each URL in it is recorded
   with the error.
5. **Collect expressions** from column C.
6. **Cross-validate** declared tokens against tokens used in expressions.
7. **Report** the results in a dialogue.

Failures are stored in `CONFIG.fetchFailures`, which is reset at the start of
every run.

## Functions

| Function | Purpose |
| --- | --- |
| `validateTestReferences()` | Menu entry point; performs the validation. |
| `collectInvalidCharTokens()` | Maps tokens with invalid characters to rows. |
| `alertAndReturn()` | Shows an alert dialogue. |
| `columnLetterToIndex()` | Converts `"A"` to 1, `"AA"` to 27. |
| `indexToColumnLetter()` | Converts 1 to `"A"`, 27 to `"AA"`. |

`columnLetterToIndex()` and `indexToColumnLetter()` are also used by
[CheckUrls.gs](check-urls.md).

## Dependencies

- `CONFIG` and `findStartRowFromArray()` from
  [MenuAndConfig.gs](menu-and-config.md)
- `extractUrlFromFormula()` from
  [GenerateBenchmarkAlgorithmDescription.gs](generate-benchmark-algorithm-description.md)

## Troubleshooting

- **"Error: Sheet ... not found"**: check `sourceSheetName` in `CONFIG`.
- **"Error: Test GUID not found"**: column B must contain a cell with exactly
  the `startMarker` text.
- **A token is reported missing from expressions but appears to be used**:
  check for differences in letter case, since matching is case-sensitive.
- **A Test GUID is reported with an unexpected HTTP failure**: open the URL in
  a browser to confirm whether the server is down or blocking automated
  requests.
