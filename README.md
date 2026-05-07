# SUSE Support Bundle Analyzer

First working version of a web application for Technical Support Engineers to upload product support bundles and choose the product analyzer scope.

Current scope:

- Upload a Support Bundle from the browser
- Select product type: Longhorn or Harvester
- Save the uploaded bundle to an NFS-backed filesystem path
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
  metadata/
    bundles.json
```

The application stores only metadata in `bundles.json`. The original bundle file stays under `BUNDLE_STORAGE_DIR`.

These directories are intentionally ignored by git because support bundles may contain customer-sensitive data.

For NFS, the recommended production layout is:

```text
/mnt/suse-support-bundles/
  {bundle_id}/{original_filename}

/var/lib/suse-support-bundle-analyzer/
  metadata/bundles.json
```

## API

### `GET /api/products`

Returns supported product options.

### `POST /api/bundles`

Uploads one support bundle.

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

## Next Steps

- Add asynchronous analysis jobs
- Add product-specific analyzers for Longhorn and Harvester
- Add authentication, retention policies, and sensitive-data scanning before analysis
- Move metadata from JSON to PostgreSQL once multiple app instances or workers are introduced
