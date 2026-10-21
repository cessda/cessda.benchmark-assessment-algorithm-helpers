# CheckUrls.gs

`CheckUrls.gs` provides the **FAIR Metrics > Validate Guidance URLs** menu
item. It checks that every condition in the algorithm has guidance and that the
guidance links can be reached.

## What it checks

The check covers the _condition region_: the rows below the `Description`
marker in the source column, down to the end of the condition list. For each
row with a condition in column C, the script reports:

- a condition with no guidance in column F
- a guidance URL that returns an HTTP status below 200 or of 400 and above
- a guidance URL that cannot be fetched at all, for example because of a DNS
  or network error
- a guidance cell from which no URL could be extracted

Redirects are followed, so a link that redirects to a working page passes.

## Running the check

1. Open the spreadsheet and wait for the **FAIR Metrics** menu to appear.
2. Choose **FAIR Metrics > Validate Guidance URLs**.
3. Wait for the results dialogue. Allow about one second per URL, because of
   the delay between requests.

If everything passes, the dialogue confirms that all guidance URLs are present
and accessible. Otherwise it lists each problem with its row number, followed
by the number of rows checked. The same text is written to the execution log
(**Extensions > Apps Script > Executions**).

## Sheet layout

The script uses these locations, derived from `CONFIG` in
[MenuAndConfig.gs](menu-and-config.md):

| Item | Location |
| ---| --- |
| Source sheet | `CONFIG.sourceSheetName` |
| Stop marker | `CONFIG.stopMarker` in `CONFIG.sourceColumn` |
| Condition column | The column after `CONFIG.sourceColumn` (C) |
| Guidance column | `CONFIG.guidanceColumn` (F) |

The condition region starts on the row after the stop marker. The script stops
after `CONFIG.maxConsecutiveEmpty` consecutive empty condition cells. Rows
with an empty condition are skipped and are not reported.

### Guidance cell format

A guidance cell holds a list of link and description pairs, for example:

```text
[[https://example.org/a,"First guide"],[https://example.org/b,"Second"]]
```

The URLs are not quoted, so `JSON.parse` cannot be used. The script extracts
each `http` or `https` URL that follows an opening bracket and precedes a
comma. If no URL is found in that form, a cell containing just a bare URL is
accepted as a fallback.

## How it works

1. Locate the stop marker row in the source column.
2. Collect each condition row and its guidance value until the end of the
   region.
3. Record rows with missing guidance, and extract the URLs from the others.
4. Fetch each URL with `UrlFetchApp`, with `muteHttpExceptions` enabled, and
   record any failure.
5. Pause for `CONFIG.requestDelayMs` after each URL.
6. Display and log a summary.

## Functions

| Function | Purpose |
| ---| --- |
| `validateGuidanceUrls()` | Menu entry point; performs the whole check. |
| `sheet_getValue()` | Reads a cell from a column letter and row number. |

## Dependencies

- `CONFIG` from [MenuAndConfig.gs](menu-and-config.md)
- `columnLetterToIndex()` and `indexToColumnLetter()` from
  [ValidateTestReferences.gs](validate-test-references.md)

## Limitations

- URLs are fetched one at a time, so a long list can approach the Apps Script
  execution time limit. If it times out, shorten the list.
- The guidance column defaults to F. To use another column, change
  `guidanceColumn` in `CONFIG`.
