# MenuAndConfig.gs

`MenuAndConfig.gs` is the entry point and shared foundation for the other
scripts. It adds the **FAIR Metrics** menu to the spreadsheet and holds the
central `CONFIG` object and one helper used by several scripts.

## Menu

`onOpen()` runs automatically whenever the spreadsheet is opened. It must not
be called manually. It creates the following menu:

- **Validate Test References** runs `validateTestReferences`. See
  [ValidateTestReferences.gs](validate-test-references.md).
- **Validate Guidance URLs** runs `validateGuidanceUrls`. See
  [CheckUrls.gs](check-urls.md).
- **Generate Report** runs `generateFAIRMetricsReport`. See
  [GenerateBenchmarkAlgorithmDescription.gs](generate-benchmark-algorithm-description.md).

After adding or changing the script, reload the spreadsheet so that the menu
appears.

## Configuration

All scripts read their settings from the `CONFIG` constant. Edit the values
here to adapt the scripts to a differently structured spreadsheet; no other
code needs to change.

| Option | Default | Description |
|---|---|---|
| `sourceSheetName` | `"Algorithm"` | Sheet with the algorithm. |
| `targetSheetName` | `"Description"` | Sheet for the generated report. |
| `sourceColumn` | `"B"` | Markers and Test GUID links. |
| `startMarker` | `"Test GUID"` | Cell text after which scanning begins. |
| `stopMarker` | `"Description"` | Cell text that ends the Test GUID block. |
| `requestDelayMs` | `1000` | Pause between HTTP requests, in milliseconds. |
| `maxConsecutiveEmpty` | `3` | Consecutive empty cells that end a block. |
| `guidanceColumn` | `"F"` | Column with guidance links. |
| `fetchFailures` | `[]` | Working list populated at run time; do not edit. |

Increase `requestDelayMs` if the remote servers respond with HTTP 429 (too
many requests).

## Expected sheet layout

The scripts assume the following layout on the source sheet:

| Column | Content |
|---|---|
| A | Test reference tokens, one per row |
| B | Markers and Test GUID hyperlinks (`sourceColumn`) |
| C | Boolean condition expressions below the `stopMarker` row |
| F | Guidance links for each condition, below the `stopMarker` row |

The Test GUID hyperlinks sit in column B between the row containing
`Test GUID` and the row containing `Description`. The conditions sit below
the `Description` row.

## Shared helper

### `findStartRowFromArray(sourceColValues)`

Returns the 1-based row number immediately after the `startMarker` row, or
`null` if the marker is not found. It searches an array that has already been
read from the sheet, which avoids one API call per cell.

Apps Script shares one global scope across all files in a project, so the
other scripts call this function directly.

## Dependencies

This file has no dependencies. Every other script depends on it for `CONFIG`.
