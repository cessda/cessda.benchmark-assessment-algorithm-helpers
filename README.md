# CESSDA Benchmark Assessment Algorithm helpers

This repository contains Google Apps Script helpers for working with a Google
Benchmark Assessment Algorithm spreadsheet. They validate the algorithm and
generate a report describing the tests and metrics it uses.

## Overview

The scripts are in the [scripts](scripts) directory. Together they add a
**FAIR Metrics** menu to the spreadsheet with three actions:

| Menu item | Purpose |
|---|---|
| Validate Test References | Checks tokens, expressions and Test GUID links |
| Validate Guidance URLs | Checks that guidance links are present and work |
| Generate Report | Builds a report of tests, metrics and descriptions |

## Documentation

Each script has its own document in the [docs](docs) directory:

1. [MenuAndConfig.gs](docs/menu-and-config.md): the menu, the shared
   `CONFIG` object and the expected sheet layout.
2. [ValidateTestReferences.gs](docs/validate-test-references.md): checks that
   declared tokens and condition expressions agree, and that Test GUID links
   resolve.
3. [CheckUrls.gs](docs/check-urls.md): checks the guidance links for each
   condition.
4. [GenerateBenchmarkAlgorithmDescription.gs](docs/generate-benchmark-algorithm-description.md):
   generates the report from the RDF records of each test and metric.

## Quick start

1. Open your Google Benchmark Assessment algorithm spreadsheet.
2. Go to **Extensions > Apps Script**.
3. Copy each file from [scripts](scripts) into the project, keeping the file
   names. The files share one global scope and depend on each other, so all
   four are required.
4. Save, then reload the spreadsheet.
5. Use the **FAIR Metrics** menu.

The scripts expect a sheet named `Algorithm` with markers in column B. See
[MenuAndConfig.gs](docs/menu-and-config.md) for the layout and for the
settings you can change.

## Requirements

- A Google spreadsheet with permission to run Apps Script
- Internet access, as the scripts fetch the linked tests, metrics and guidance

## Contributing

Please read [CONTRIBUTING](CONTRIBUTING.md) for details on our code of conduct,
and the process for submitting pull requests to us.

## Versioning

See [Semantic Versioning](https://semver.org/) for guidance.

## Contributors

The list of contributors is in the [CONTRIBUTORS](CONTRIBUTORS.md) file.

## License

See the [LICENSE](LICENSE.txt) file.

## Citing

See the [CITATION](CITATION.cff) file.
