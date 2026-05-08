# SUSE Support Bundle Analyzer

Web application for Technical Support Engineers to upload product support bundles, run product-specific analysis, and connect findings with an imported knowledge base.

Current scope:

- Upload a Support Bundle from the browser
- Select product type: Longhorn or Harvester
- Save the uploaded bundle to an NFS-backed filesystem path
- Create an analysis job automatically after upload
- Safely extract common archive formats and generate a file index report
- Run Longhorn inventory checks, finding correlation, and grouped diagnostics
- Import Longhorn KB URLs from the UI and store a local vector index
- Show related KB articles on correlated Longhorn findings
- Persist bundle metadata as JSON
- Show recent uploads in the UI

## Requirements

- Node.js 20 or newer

No runtime npm dependencies are required for the current first version.

## Run Locally

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
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

When `BUNDLE_STORAGE_DIR` is set, the directory must already exist and be readable/writable by the application user. This helps avoid silently writing support bundles to local disk when the NFS mount is missing.

## Storage Layout

The application stores bundle files under `BUNDLE_STORAGE_DIR`. In development, the default is `./data/bundles`:

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

The application stores only metadata in `bundles.json`. The original bundle file stays under `BUNDLE_STORAGE_DIR`.

These directories are intentionally ignored by git because support bundles may contain customer-sensitive data.

For NFS, the recommended production layout is:

```text
/mnt/suse-support-bundles/
  {bundle_id}/{original_filename}

/var/lib/suse-support-bundle-analyzer/
  kb/kb-index.json
  metadata/bundles.json
```

The KB index stores normalized article metadata, text chunks, and local hash vectors. It is intentionally stored outside git because imported KB content can change independently from the application code.

## API

### `GET /api/products`

Returns supported product options.

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

### `GET /api/bundles`

Returns recent uploaded bundle metadata.

### `DELETE /api/bundles/{id}`

Deletes the uploaded bundle file, bundle metadata, and related analysis jobs, reports, and work files. Deletion is blocked while an analysis job is actively running for that bundle.

### `GET /api/analysis-jobs`

Returns recent analysis jobs.

### `GET /api/analysis-jobs/{id}`

Returns one analysis job.

### `GET /api/analysis-jobs/{id}/report`

Returns the generated safe-extraction file index report for a completed analysis job. If KB data has been imported, Longhorn finding groups include related KB matches.

### `GET /api/kb/status`

Returns local KB index status, including document count, chunk count, embedding provider, and source metadata.

### `POST /api/kb/import-url`

Imports one or more KB URLs and rebuilds matching local vector chunks. Passing the Longhorn KB index URL expands all article links found under `/kb/`.

JSON body:

```json
{
  "urls": ["https://longhorn.io/kb/"]
}
```

### `GET /api/kb/search?q={query}`

Searches the local KB vector index. Optional query parameters:

- `productType`: product filter, for example `longhorn`
- `limit`: result count from `1` to `20`

## Next Steps

- Add Harvester-specific findings and KB matching
- Add a pluggable semantic embedding provider for richer KB matching
- Add authentication, retention policies, and sensitive-data scanning before analysis
- Move metadata from JSON to PostgreSQL once multiple app instances or workers are introduced
