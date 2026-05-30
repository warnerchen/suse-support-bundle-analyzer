# SUSE Support Bundle Analyzer

Web application for Technical Support Engineers to upload SUSE product support bundles, run product-specific analysis, inspect raw evidence, and connect findings with an imported knowledge base.

## Current Scope

- Upload support bundle archives from the browser.
- Select product type during upload: Longhorn or Harvester.
- Prevent duplicate uploads for the same product by comparing bundle SHA-256 checksums.
- Store uploaded bundle files on a local or NFS-backed filesystem path.
- Create and resume background analysis jobs automatically.
- Safely list, validate, and extract common archive formats.
- Generate a safe file index and largest-file summary for each bundle.
- Run Longhorn and Harvester inventory checks, finding correlation, and grouped diagnostics.
- Correlate affected Harvester VM workloads with VMIs, migrations, images, networks, events, logs, and source evidence.
- Detect Longhorn and Harvester component versions from product resources, labels, annotations, and images.
- Preview raw evidence files from findings, largest files, and the file index.
- Open log evidence directly around the matched line with highlighted context.
- Import KB content from URLs or batch Markdown uploads.
- Preview KB imports with quality checks before indexing.
- Manage imported KB sources from the UI.
- Store a local KB vector index and show related KB articles on product finding groups.
- Delete bundles together with related jobs, reports, and extracted work files.

## Requirements

- Node.js 20 or newer
- `tar` and `unzip` available on the host for archive listing/extraction

No runtime npm dependencies are required. The server uses Node.js built-in modules and browser-native frontend code.

## Run Locally

```bash
npm run dev
```

Then open:

```text
http://127.0.0.1:3000
```

You can override the port and data location:

```bash
PORT=4000 DATA_DIR=/path/to/data npm run dev
```

KB storage and import behavior can also be configured:

```bash
KB_STORAGE_DIR=/path/to/kb KB_REMOTE_IMPORT_LIMIT=100 KB_EMBEDDING_DIMENSIONS=256 npm run dev
```

For a production-like NFS setup, mount the NFS export first, then point the app at that mount path:

```bash
BUNDLE_STORAGE_DIR=/mnt/suse-support-bundles DATA_DIR=/var/lib/suse-support-bundle-analyzer npm run dev
```

When `BUNDLE_STORAGE_DIR` is set, the directory must already exist and be readable/writable by the application user. This avoids silently writing support bundles to local disk when the NFS mount is missing.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP bind address |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Root for local app data |
| `BUNDLE_STORAGE_DIR` | `./data/bundles` | Bundle file storage root |
| `METADATA_DIR` | `./data/metadata` | JSON metadata storage root |
| `ANALYSIS_WORK_DIR` | `./data/work` | Extracted bundle work directory |
| `KB_STORAGE_DIR` | `./data/kb` | KB index storage root |
| `MAX_UPLOAD_BYTES` | `1073741824` | Upload size limit |
| `MAX_ARCHIVE_ENTRIES` | `20000` | Maximum archive entries accepted |
| `MAX_EXTRACTED_BYTES` | `2147483648` | Maximum extracted bundle size |
| `MAX_REPORT_FILE_ENTRIES` | `5000` | File index entries kept in reports |
| `KB_EMBEDDING_DIMENSIONS` | `256` | Dimensions for the local hash vector provider |
| `KB_REMOTE_FETCH_TIMEOUT_MS` | `15000` | Remote KB fetch timeout |
| `KB_REMOTE_IMPORT_LIMIT` | `80` | Maximum discovered URLs imported per URL request |
| `KB_TEXT_IMPORT_MAX_BYTES` | `2097152` | Maximum remote or Markdown KB document size |

## Storage Layout

The default development layout is:

```text
data/
  bundles/
    {bundle_id}/{original_filename}
  kb/
    kb-index.json
  metadata/
    bundles.json
    analysis-jobs.json
    analysis-reports/{job_id}.json
  work/
    {job_id}/extracted/
```

Only metadata is stored in `bundles.json`; the original uploaded bundle remains under `BUNDLE_STORAGE_DIR`. Extracted files live under `ANALYSIS_WORK_DIR` so the evidence preview API can safely read files for completed reports.

These directories are intentionally ignored by git because support bundles may contain customer-sensitive data.

For NFS-backed bundle storage, a typical layout is:

```text
/mnt/suse-support-bundles/
  {bundle_id}/{original_filename}

/var/lib/suse-support-bundle-analyzer/
  kb/kb-index.json
  metadata/bundles.json
  metadata/analysis-jobs.json
  metadata/analysis-reports/{job_id}.json
  work/{job_id}/extracted/
```

## Architecture

The app is intentionally small and modular:

- `src/server.js`: HTTP routing, static file serving, API request validation, service wiring.
- `src/services/bundleService.js`: bundle upload, validation, and deletion workflow.
- `src/services/analysisService.js`: analysis job queue, job resume, report persistence, report enrichment.
- `src/storage/nfsBundleStorage.js`: filesystem-backed bundle storage with optional NFS mount enforcement.
- `src/repositories/*`: JSON-backed metadata repositories.
- `src/analysis/archiveAnalyzer.js`: archive validation, safe extraction, file index generation, evidence file preview.
- `src/analysis/longhornAnalyzer.js`: Longhorn inventory, version detection, findings, finding groups, log evidence references.
- `src/analysis/harvesterAnalyzer.js`: Harvester inventory, version detection, findings, finding groups, log evidence references.
- `src/kb/kbService.js`: URL/Markdown KB preview, quality checks, import, source deletion, report enrichment.
- `src/kb/kbStore.js`: local KB document/chunk/vector persistence and search.
- `src/kb/localEmbeddingProvider.js`: deterministic local hash vectors for offline testing.
- `public/*`: browser UI.

The current KB vector provider is `local-hash-v1`. It is useful for local development and deterministic tests, but it is not a semantic embedding model. A production semantic embedding provider and external vector database can be added behind the KB store/provider boundary later.

## Longhorn Analysis

The Longhorn analyzer currently extracts:

- Bundle metadata such as Kubernetes version, creation time, and support bundle issue description.
- Longhorn version from `current-longhorn-version`, app labels, Helm chart labels, Longhorn driver annotations, EngineImage status, and Longhorn image tags.
- Inventory counts for volumes, replicas, nodes, pods, events, and scanned logs.
- Findings for unhealthy volumes, non-running replicas, node prerequisite issues, pod restarts, warning events, Prometheus alerts, bundle collection gaps, and selected Longhorn log patterns.
- Correlated finding groups with impact, recommended checks, affected metrics, evidence, and related KB matches.

The `issuedescription` field in `metadata.yaml` is displayed as `Issue Description`. It is bundle-provided text, not product detection.

## Harvester Analysis

The Harvester analyzer currently extracts:

- Bundle metadata such as Kubernetes version, creation time, and support bundle issue description.
- Harvester version from the installed Harvester app chart, pod labels/images, addon specs, and available `Version` resources.
- Inventory counts for cluster nodes, harvester-system pods, catalog apps, addons, KubeVirt/CDI, VM workloads, VM images, VLAN statuses, events, and scanned logs.
- Findings for collection gaps, node condition/NTP issues, Harvester pod restarts, app/addon readiness, KubeVirt/CDI readiness, VM workload readiness, migration failures, VM image import failures, VLAN readiness, warning events, and selected Harvester/KubeVirt log patterns.
- Affected VM workload correlations that connect VM, VMI, migration, image, node, network, event, log, and source-file evidence into an impact map.
- Correlated finding groups with impact, recommended checks, affected metrics, evidence, and related KB matches.

## KB Index

KB sources can be imported from:

- One or more remote URLs.
- Same-path link expansion from index-style pages such as `/kb/`, `/docs/`, or `/troubleshooting/`.
- Batch Markdown uploads (`.md` and `.markdown`).

Before import, the UI can preview documents and show quality status:

- `ready`: importable.
- `warning`: importable but worth reviewing, for example short content or missing title.
- `blocked`: not importable, for example dynamic shell pages without readable article text.

Imported documents are normalized, chunked, embedded with `local-hash-v1`, and stored in `kb-index.json`. Reports are enriched by searching the KB index for each product finding group.

## API

### `GET /api/health`

Returns service health.

### `GET /api/products`

Returns supported product options, allowed archive suffixes, and upload limits.

### `POST /api/bundles`

Uploads one support bundle and creates an analysis job.

Multipart form fields:

- `productType`: `longhorn` or `harvester`
- `bundleFile`: support bundle archive

Supported archive suffixes:

- `.zip`
- `.tar`
- `.tar.gz`
- `.tgz`
- `.tar.xz`
- `.txz`
- `.tar.bz2`
- `.tbz2`
- `.tar.zst`
- `.gz`

If a bundle with the same product type and SHA-256 checksum already exists, the API returns `409` with `details.code` set to `duplicate_bundle` and the existing bundle summary in `details.existingBundle`.

### `GET /api/bundles`

Returns recent uploaded bundle metadata.

### `GET /api/bundles/{id}`

Returns one uploaded bundle metadata record.

### `DELETE /api/bundles/{id}`

Deletes the uploaded bundle file, bundle metadata, related analysis jobs, reports, and extracted work files. Deletion is blocked while an analysis job is actively running for that bundle.

### `GET /api/analysis-jobs`

Returns recent analysis jobs.

### `GET /api/analysis-jobs/{id}`

Returns one analysis job.

### `GET /api/analysis-jobs/{id}/report`

Returns the generated analysis report for a completed analysis job. If KB data has been imported, finding groups include related KB matches.

For older reports, the server may enrich missing derived fields such as product version from the retained extracted files.

### `GET /api/analysis-jobs/{id}/files?path={reportPath}`

Returns a safe preview of one extracted support bundle file for an analysis job.

Optional query parameters:

- `lineStart`: line number to center in the preview.
- `lineEnd`: final line number to highlight.
- `matchText`: text excerpt used to relocate the matching line when a stale line number is no longer exact.

The preview is limited to regular text files inside the job extraction directory. Absolute paths, parent directory traversal, symlinks, binary files, and missing files are rejected or marked unavailable.

### `GET /api/kb/status`

Returns local KB index status, including document count, chunk count, embedding provider, dimensions, updated time, and source metadata.

### `GET /api/kb/sources`

Returns imported KB sources.

Optional query parameters:

- `productType`: product filter, for example `longhorn`

### `DELETE /api/kb/sources/{id}`

Deletes one imported KB source and its indexed chunks.

### `POST /api/kb/preview-url`

Previews one or more KB URLs without mutating the local KB index.

JSON body:

```json
{
  "urls": ["https://longhorn.io/kb/"],
  "expandLinks": true,
  "productType": "longhorn"
}
```

### `POST /api/kb/import-url`

Imports one or more KB URLs and rebuilds matching local vector chunks. When `expandLinks` is enabled, an index-style URL expands same-origin links under the same path prefix. A single article URL can be imported directly by setting `expandLinks` to `false`.

JSON body:

```json
{
  "urls": ["https://longhorn.io/kb/"],
  "expandLinks": true,
  "productType": "longhorn"
}
```

### `POST /api/kb/preview-files`

Previews one or more Markdown files without mutating the local KB index.

Multipart form fields:

- `productType`: optional product scope, currently `longhorn` or `harvester`; omit for auto-detect.
- `kbFiles`: one or more `.md` or `.markdown` files.

### `POST /api/kb/import-files`

Imports one or more Markdown files and rebuilds matching local vector chunks.

Multipart form fields:

- `productType`: optional product scope, currently `longhorn` or `harvester`; omit for auto-detect.
- `kbFiles`: one or more `.md` or `.markdown` files.

### `GET /api/kb/search?q={query}`

Searches the local KB vector index.

Optional query parameters:

- `productType`: product filter, for example `longhorn`
- `limit`: result count from `1` to `20`

## Development

Run tests:

```bash
npm test
```

Useful checks before committing:

```bash
node --check src/server.js
node --check src/analysis/archiveAnalyzer.js
node --check src/analysis/longhornAnalyzer.js
node --check src/analysis/harvesterAnalyzer.js
node --check public/app.js
git diff --check
```

## Security Notes

- Archive paths are validated before extraction.
- Absolute paths, parent traversal, unsafe Windows paths, and symlink previews are rejected.
- Extracted size and entry count are bounded by configuration.
- Uploaded filenames are sanitized before storage.
- Static file responses include security headers.
- Support bundles and KB indexes are stored outside git by default.

This project does not yet include authentication, authorization, multi-user tenancy, retention policies, or sensitive-data scanning.

## Suggested Next Work

- Add Longhorn volume-to-replica/node correlation when support bundles include enough cross-resource detail.
- Add a pluggable semantic embedding provider.
- Add an external vector database backend such as Qdrant for KB chunks.
- Move metadata from JSON files to PostgreSQL when multiple app instances or workers are introduced.
- Add authentication and role-based access before exposing the service beyond a trusted local network.
- Add retention and redaction controls for customer-sensitive bundle data.
