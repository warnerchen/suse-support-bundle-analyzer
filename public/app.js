const apiStatus = document.querySelector('#apiStatus');
const uploadLimit = document.querySelector('#uploadLimit');
const form = document.querySelector('#uploadForm');
const fileInput = document.querySelector('#bundleFile');
const fileName = document.querySelector('#fileName');
const formMessage = document.querySelector('#formMessage');
const progressBar = document.querySelector('#progressBar');
const submitButton = document.querySelector('#submitButton');
const refreshButton = document.querySelector('#refreshButton');
const bundleRows = document.querySelector('#bundleRows');
const productOptions = document.querySelector('#productOptions');
const dropZone = document.querySelector('#dropZone');
const reportPanel = document.querySelector('#analysisReportPanel');
const reportContent = document.querySelector('#reportContent');
const deleteModal = document.querySelector('#deleteModal');
const deleteModalFilename = document.querySelector('#deleteModalFilename');
const deleteModalMessage = document.querySelector('#deleteModalMessage');
const cancelDeleteButton = document.querySelector('#cancelDeleteButton');
const confirmDeleteButton = document.querySelector('#confirmDeleteButton');
const kbUrlImportForm = document.querySelector('#kbUrlImportForm');
const kbFileImportForm = document.querySelector('#kbFileImportForm');
const kbUrlInput = document.querySelector('#kbUrlInput');
const kbImportButton = document.querySelector('#kbImportButton');
const kbFileInput = document.querySelector('#kbFileInput');
const kbFileName = document.querySelector('#kbFileName');
const kbFileImportButton = document.querySelector('#kbFileImportButton');
const kbExpandLinks = document.querySelector('#kbExpandLinks');
const kbProductType = document.querySelector('#kbProductType');
const kbMessage = document.querySelector('#kbMessage');
const kbStats = document.querySelector('#kbStats');
const kbPreviewPanel = document.querySelector('#kbPreviewPanel');
const kbSourceFilter = document.querySelector('#kbSourceFilter');
const kbSourceList = document.querySelector('#kbSourceList');

let maxUploadBytes = 0;
let pollTimer = null;
let pendingDelete = null;
let previousFocus = null;
let pendingKbImport = null;
let kbSources = [];

await initialize();

async function initialize() {
  bindEvents();

  try {
    const response = await fetch('/api/products');
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? 'API unavailable');
    }

    maxUploadBytes = payload.maxUploadBytes;
    uploadLimit.textContent = `Limit ${formatBytes(maxUploadBytes)}`;
    setApiStatus('Ready', 'ready');
    await Promise.all([refreshDashboard(), loadKbStatus()]);
  } catch (error) {
    setApiStatus('API offline', 'error');
    setFormMessage(error.message, 'error');
  }
}

function bindEvents() {
  productOptions.addEventListener('change', () => {
    for (const segment of productOptions.querySelectorAll('.segment')) {
      const input = segment.querySelector('input');
      segment.classList.toggle('selected', input.checked);
    }
  });

  fileInput.addEventListener('change', () => {
    updateSelectedFile({ clearFeedback: false });
  });

  for (const eventName of ['dragenter', 'dragover']) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('dragging');
    });
  }

  for (const eventName of ['dragleave', 'drop']) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('dragging');
    });
  }

  dropZone.addEventListener('drop', (event) => {
    const file = event.dataTransfer.files?.[0];

    if (!file) {
      return;
    }

    fileInput.files = event.dataTransfer.files;
    updateSelectedFile();
  });

  refreshButton.addEventListener('click', refreshDashboard);
  form.addEventListener('submit', uploadBundle);
  kbUrlImportForm.addEventListener('submit', previewKbUrls);
  kbFileImportForm.addEventListener('submit', previewKbFiles);
  kbUrlInput.addEventListener('input', clearKbPreview);
  kbFileInput.addEventListener('change', updateSelectedKbFiles);
  kbProductType.addEventListener('change', clearKbPreview);
  kbExpandLinks.addEventListener('change', clearKbPreview);
  kbSourceFilter.addEventListener('change', () => renderKbSources(kbSources));
  kbPreviewPanel.addEventListener('click', (event) => {
    const confirmButton = event.target.closest('[data-confirm-kb-import]');

    if (confirmButton) {
      confirmKbImport();
      return;
    }

    const cancelButton = event.target.closest('[data-cancel-kb-preview]');

    if (cancelButton) {
      clearKbPreview();
      setKbMessage('');
    }
  });
  kbSourceList.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-delete-kb-source-id]');

    if (deleteButton) {
      deleteKbSource(deleteButton.dataset.deleteKbSourceId, deleteButton.dataset.title, deleteButton);
    }
  });
  bundleRows.addEventListener('click', (event) => {
    const reportButton = event.target.closest('[data-report-job-id]');

    if (reportButton) {
      loadReport(reportButton.dataset.reportJobId);
      return;
    }

    const deleteButton = event.target.closest('[data-delete-bundle-id]');

    if (deleteButton) {
      openDeleteModal(deleteButton.dataset.deleteBundleId, deleteButton.dataset.filename);
    }
  });

  cancelDeleteButton.addEventListener('click', closeDeleteModal);

  confirmDeleteButton.addEventListener('click', () => {
    if (!pendingDelete) {
      return;
    }

    deleteBundle(pendingDelete.bundleId, pendingDelete.filename);
  });

  deleteModal.addEventListener('click', (event) => {
    if (event.target === deleteModal && !confirmDeleteButton.disabled) {
      closeDeleteModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !deleteModal.hidden && !confirmDeleteButton.disabled) {
      closeDeleteModal();
    }
  });
}

function updateSelectedFile({ clearFeedback = true } = {}) {
  const file = fileInput.files?.[0];
  fileName.textContent = file ? `${file.name} · ${formatBytes(file.size)}` : 'No file selected';

  if (clearFeedback) {
    setFormMessage('');
    setProgress(0);
  }
}

function updateSelectedKbFiles() {
  const files = [...(kbFileInput.files ?? [])];
  clearKbPreview();

  if (!files.length) {
    kbFileName.textContent = 'No files selected';
    return;
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  kbFileName.textContent = `${files.length} file${files.length === 1 ? '' : 's'} · ${formatBytes(totalBytes)}`;
  setKbMessage('');
}

async function uploadBundle(event) {
  event.preventDefault();

  const file = fileInput.files?.[0];
  const productType = new FormData(form).get('productType');

  if (!productType) {
    setFormMessage('Choose Longhorn or Harvester.', 'error');
    return;
  }

  if (!file) {
    setFormMessage('Select a support bundle archive.', 'error');
    return;
  }

  if (maxUploadBytes && file.size > maxUploadBytes) {
    setFormMessage(`File is larger than ${formatBytes(maxUploadBytes)}.`, 'error');
    return;
  }

  submitButton.disabled = true;
  setFormMessage('Uploading');
  setProgress(1);

  const formData = new FormData();
  formData.append('productType', productType);
  formData.append('bundleFile', file);

  try {
    const payload = await sendWithProgress('/api/bundles', formData, setProgress);
    setProgress(100);
    setFormMessage(`Uploaded ${payload.bundle.originalFilename}; analysis queued`, 'success');
    form.reset();
    productOptions.querySelector('input[value="longhorn"]').checked = true;
    productOptions.dispatchEvent(new Event('change'));
    updateSelectedFile();
    setProgress(100);
    await refreshDashboard();
  } catch (error) {
    setFormMessage(error.message, 'error');
    setProgress(0);
  } finally {
    submitButton.disabled = false;
  }
}

async function loadKbStatus() {
  try {
    const response = await fetch('/api/kb/status');
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? 'Unable to load KB status.');
    }

    renderKbStatus(payload.kb);
  } catch (error) {
    setKbMessage(error.message, 'error');
    kbStats.innerHTML = '<p class="empty-report">KB status unavailable</p>';
    kbSourceList.innerHTML = '<p class="empty-report">KB sources unavailable</p>';
  }
}

async function previewKbUrls(event) {
  event.preventDefault();

  const urls = kbUrlInput.value
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (!urls.length) {
    setKbMessage('Enter at least one KB URL.', 'error');
    return;
  }

  kbImportButton.disabled = true;
  clearKbPreview();
  setKbMessage('Previewing KB URLs');

  try {
    const importRequest = {
      type: 'urls',
      urls,
      expandLinks: kbExpandLinks.checked,
      productType: kbProductType.value || null,
    };
    const response = await fetch('/api/kb/preview-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(importRequest),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? 'KB preview failed.');
    }

    pendingKbImport = payload.preview?.importableCount ? importRequest : null;
    renderKbPreview(payload.preview);
    renderKbStatus(payload.kb);
    setKbPreviewMessage(payload.preview);
  } catch (error) {
    setKbMessage(error.message, 'error');
  } finally {
    kbImportButton.disabled = false;
  }
}

async function previewKbFiles(event) {
  event.preventDefault();

  const files = [...(kbFileInput.files ?? [])];

  if (!files.length) {
    setKbMessage('Select at least one Markdown file.', 'error');
    return;
  }

  const invalidFile = files.find((file) => !/\.(md|markdown)$/i.test(file.name));

  if (invalidFile) {
    setKbMessage(`${invalidFile.name} is not a Markdown file.`, 'error');
    return;
  }

  kbFileImportButton.disabled = true;
  clearKbPreview();
  setKbMessage('Previewing Markdown files');

  const formData = new FormData();
  formData.append('productType', kbProductType.value || '');

  for (const file of files) {
    formData.append('kbFiles', file);
  }

  try {
    const response = await fetch('/api/kb/preview-files', {
      method: 'POST',
      body: formData,
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? 'KB file preview failed.');
    }

    pendingKbImport = payload.preview?.importableCount
      ? {
          type: 'files',
          files,
          productType: kbProductType.value || null,
        }
      : null;
    renderKbPreview(payload.preview);
    renderKbStatus(payload.kb);
    setKbPreviewMessage(payload.preview);
  } catch (error) {
    setKbMessage(error.message, 'error');
  } finally {
    kbFileImportButton.disabled = false;
  }
}

async function confirmKbImport() {
  if (!pendingKbImport) {
    setKbMessage('Preview the KB source before importing.', 'error');
    return;
  }

  const confirmButton = kbPreviewPanel.querySelector('[data-confirm-kb-import]');
  const cancelButton = kbPreviewPanel.querySelector('[data-cancel-kb-preview]');
  confirmButton.disabled = true;
  cancelButton.disabled = true;
  setKbMessage('Importing previewed KB sources');

  try {
    const payload = pendingKbImport.type === 'urls' ? await importPreviewedUrls(pendingKbImport) : await importPreviewedFiles(pendingKbImport);

    if (pendingKbImport.type === 'files') {
      kbFileImportForm.reset();
      updateSelectedKbFiles();
    }

    clearKbPreview();
    await handleKbImportSuccess(payload);
  } catch (error) {
    setKbMessage(error.message, 'error');
    confirmButton.disabled = false;
    cancelButton.disabled = false;
  }
}

async function importPreviewedUrls(importRequest) {
  const response = await fetch('/api/kb/import-url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      urls: importRequest.urls,
      expandLinks: importRequest.expandLinks,
      productType: importRequest.productType,
    }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error?.message ?? 'KB import failed.');
  }

  return payload;
}

async function importPreviewedFiles(importRequest) {
  const formData = new FormData();
  formData.append('productType', importRequest.productType || '');

  for (const file of importRequest.files) {
    formData.append('kbFiles', file);
  }

  const response = await fetch('/api/kb/import-files', {
    method: 'POST',
    body: formData,
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error?.message ?? 'KB file import failed.');
  }

  return payload;
}

async function handleKbImportSuccess(payload) {
  const imported = payload.import?.documentsImported ?? 0;
  const chunks = payload.import?.chunksIndexed ?? 0;
  const failures = payload.import?.failures ?? [];
  const failureCount = failures.length;
  const firstFailure = failures[0]?.message;

  if (!imported && failureCount) {
    setKbMessage(`No documents imported. ${firstFailure ?? `${failureCount} failed.`}`, 'error');
  } else {
    setKbMessage(
      `Imported ${imported} document${imported === 1 ? '' : 's'} and indexed ${chunks} chunk${chunks === 1 ? '' : 's'}${
        failureCount ? `; ${failureCount} failed${firstFailure ? `: ${firstFailure}` : ''}` : ''
      }`,
      failureCount ? 'warning' : 'success',
    );
  }

  renderKbStatus(payload.kb);

  if (reportContent.dataset.jobId) {
    await loadReport(reportContent.dataset.jobId);
  }
}

function setKbPreviewMessage(preview = {}) {
  const importable = preview.importableCount ?? 0;
  const blocked = preview.blockedCount ?? 0;
  const warnings = preview.warningCount ?? 0;
  const failures = preview.failures?.length ?? 0;

  if (!importable) {
    setKbMessage('Preview finished, but no importable KB documents were found.', 'error');
    return;
  }

  setKbMessage(
    `Preview ready: ${importable} importable document${importable === 1 ? '' : 's'}${
      warnings ? `, ${warnings} with warnings` : ''
    }${blocked || failures ? `, ${blocked + failures} blocked or failed` : ''}.`,
    blocked || failures || warnings ? 'warning' : 'success',
  );
}

function renderKbPreview(preview = {}) {
  const documents = preview.documents ?? [];
  const failures = preview.failures ?? [];
  const importableCount = preview.importableCount ?? 0;

  kbPreviewPanel.hidden = false;
  kbPreviewPanel.innerHTML = `
    <div class="kb-preview-header">
      <div>
        <div class="kb-field-label">Import Preview</div>
        <p>${escapeHtml(renderKbPreviewSummary(preview))}</p>
      </div>
      <div class="kb-preview-actions">
        <button class="secondary-button" type="button" data-cancel-kb-preview>Cancel</button>
        <button class="primary-button" type="button" data-confirm-kb-import ${importableCount ? '' : 'disabled'}>
          Import ${importableCount || ''}
        </button>
      </div>
    </div>
    ${
      documents.length
        ? `<div class="kb-preview-list">${documents.map(renderKbPreviewDocument).join('')}</div>`
        : '<p class="empty-report">No documents could be previewed.</p>'
    }
    ${failures.length ? `<div class="kb-preview-failures">${failures.map(renderKbPreviewFailure).join('')}</div>` : ''}
  `;
}

function renderKbPreviewSummary(preview = {}) {
  const discovered = preview.discoveredUrlCount ?? 0;
  const files = preview.requestedFiles ?? 0;
  const importable = preview.importableCount ?? 0;
  const blocked = preview.blockedCount ?? 0;
  const failures = preview.failures?.length ?? 0;

  if (files) {
    return `${files} files checked, ${importable} importable, ${blocked + failures} blocked or failed.`;
  }

  return `${discovered} URLs checked, ${importable} importable, ${blocked + failures} blocked or failed.`;
}

function renderKbPreviewDocument(document) {
  const sourceLabel = document.filename || document.sourceUri;

  return `
    <article class="kb-preview-item kb-preview-${escapeHtml(document.status)}">
      <div class="kb-preview-item-header">
        <span class="kb-quality-badge">${escapeHtml(document.status)}</span>
        <span>${escapeHtml(productLabel(document.productType))}</span>
      </div>
      <h3>${escapeHtml(document.title)}</h3>
      <p class="kb-preview-source" title="${escapeHtml(sourceLabel)}">${escapeHtml(sourceLabel)}</p>
      <div class="kb-preview-meta">
        <span>${formatInteger(document.charCount)} chars</span>
        <span>${document.chunkCount} chunk${document.chunkCount === 1 ? '' : 's'}</span>
      </div>
      <p>${escapeHtml(document.excerpt || 'No readable excerpt detected.')}</p>
      <ul>
        ${(document.qualityMessages ?? []).map((message) => `<li>${escapeHtml(message)}</li>`).join('')}
      </ul>
    </article>
  `;
}

function renderKbPreviewFailure(failure) {
  const target = failure.url ?? failure.filename ?? 'Unknown source';
  return `
    <div class="kb-preview-failure">
      <strong>${escapeHtml(target)}</strong>
      <span>${escapeHtml(failure.message)}</span>
    </div>
  `;
}

function clearKbPreview() {
  pendingKbImport = null;
  kbPreviewPanel.hidden = true;
  kbPreviewPanel.innerHTML = '';
}

function sendWithProgress(url, body, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();

    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) {
        return;
      }

      onProgress(Math.max(1, Math.round((event.loaded / event.total) * 100)));
    });

    request.addEventListener('load', () => {
      let payload = {};

      try {
        payload = JSON.parse(request.responseText || '{}');
      } catch {
        reject(new Error('Server returned an invalid response.'));
        return;
      }

      if (request.status >= 200 && request.status < 300) {
        resolve(payload);
        return;
      }

      reject(new Error(payload.error?.message ?? 'Upload failed.'));
    });

    request.addEventListener('error', () => reject(new Error('Network error during upload.')));
    request.open('POST', url);
    request.send(body);
  });
}

async function refreshDashboard() {
  try {
    const [bundleResponse, jobResponse] = await Promise.all([
      fetch('/api/bundles'),
      fetch('/api/analysis-jobs'),
    ]);
    const [bundlePayload, jobPayload] = await Promise.all([
      bundleResponse.json(),
      jobResponse.json(),
    ]);

    if (!bundleResponse.ok) {
      throw new Error(bundlePayload.error?.message ?? 'Unable to load uploads.');
    }

    if (!jobResponse.ok) {
      throw new Error(jobPayload.error?.message ?? 'Unable to load analysis jobs.');
    }

    const analysisJobs = jobPayload.analysisJobs ?? [];
    renderBundles(bundlePayload.bundles, latestJobByBundleId(analysisJobs));
    schedulePolling(analysisJobs);
  } catch (error) {
    bundleRows.innerHTML = `<tr><td colspan="8" class="empty-cell">${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderBundles(bundles, analysisJobsByBundleId) {
  if (!bundles.length) {
    bundleRows.innerHTML = '<tr><td colspan="8" class="empty-cell">No uploads yet</td></tr>';
    return;
  }

  bundleRows.innerHTML = bundles
    .map((bundle) => {
      const job = analysisJobsByBundleId.get(bundle.id);
      const canViewReport = job?.status === 'completed' && job.reportAvailable;

      return `
        <tr>
          <td><strong>${productLabel(bundle.productType)}</strong></td>
          <td class="filename-cell">${escapeHtml(bundle.originalFilename)}</td>
          <td><span class="status-badge">${escapeHtml(bundle.uploadStatus)}</span></td>
          <td>${renderAnalysisStatus(job)}</td>
          <td>${formatBytes(bundle.fileSize)}</td>
          <td><span class="muted">${formatDate(bundle.createdAt)}</span></td>
          <td>
            <button
              class="report-button"
              type="button"
              data-report-job-id="${escapeHtml(job?.id ?? '')}"
              ${canViewReport ? '' : 'disabled'}
            >
              View
            </button>
          </td>
          <td>
            <button
              class="delete-button"
              type="button"
              data-delete-bundle-id="${escapeHtml(bundle.id)}"
              data-filename="${escapeHtml(bundle.originalFilename)}"
              ${job?.status === 'running' ? 'disabled title="Analysis is running"' : ''}
            >
              Delete
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderKbStatus(kb = {}) {
  const documentCount = kb.documentCount ?? 0;
  const chunkCount = kb.chunkCount ?? 0;
  kbSources = kb.sources ?? [];
  renderKbSources(kbSources);

  if (!documentCount) {
    kbStats.innerHTML = `
      <div class="kb-stat">
        <strong>0</strong>
        <span>Documents</span>
      </div>
      <p class="empty-report">No KB imported yet</p>
    `;
    return;
  }

  kbStats.innerHTML = `
    <div class="kb-stat kb-stat-count">
      <strong>${documentCount}</strong>
      <span>Documents</span>
    </div>
    <div class="kb-stat kb-stat-count">
      <strong>${chunkCount}</strong>
      <span>Chunks</span>
    </div>
    <div class="kb-stat kb-stat-provider">
      <strong>${escapeHtml(kb.embedding?.provider ?? 'unknown')}</strong>
      <span>${escapeHtml(String(kb.embedding?.dimensions ?? ''))} dims</span>
    </div>
    <div class="kb-updated">Updated ${escapeHtml(formatDate(kb.updatedAt))}</div>
  `;
}

function renderKbSources(sources = []) {
  const productFilter = kbSourceFilter.value;
  const filteredSources = productFilter ? sources.filter((source) => source.productType === productFilter) : sources;

  if (!filteredSources.length) {
    kbSourceList.innerHTML = `<p class="empty-report">${
      sources.length ? 'No KB sources match this filter' : 'No KB sources imported yet'
    }</p>`;
    return;
  }

  kbSourceList.innerHTML = filteredSources.map(renderKbSource).join('');
}

function renderKbSource(source) {
  const sourceLabel = source.sourceUri || source.title;

  return `
    <article class="kb-source-item">
      <div class="kb-source-copy">
        <div class="kb-source-title">${escapeHtml(source.title)}</div>
        <div class="kb-source-uri" title="${escapeHtml(sourceLabel)}">${escapeHtml(sourceLabel)}</div>
        <div class="kb-source-meta">
          <span>${escapeHtml(productLabel(source.productType))}</span>
          <span>${source.chunkCount ?? 0} chunk${source.chunkCount === 1 ? '' : 's'}</span>
          <span>${formatInteger(source.charCount)} chars</span>
        </div>
      </div>
      <button
        class="delete-button kb-source-delete"
        type="button"
        data-delete-kb-source-id="${escapeHtml(source.id)}"
        data-title="${escapeHtml(source.title)}"
      >
        Delete
      </button>
    </article>
  `;
}

async function deleteKbSource(sourceId, title, button) {
  if (button.dataset.confirm !== 'true') {
    button.dataset.confirm = 'true';
    button.textContent = 'Confirm';
    setKbMessage(`Confirm deletion for ${title}.`, 'warning');
    setTimeout(() => {
      if (button.dataset.confirm === 'true') {
        button.dataset.confirm = 'false';
        button.textContent = 'Delete';
      }
    }, 3500);
    return;
  }

  button.disabled = true;
  setKbMessage(`Deleting ${title}`);

  try {
    const response = await fetch(`/api/kb/sources/${encodeURIComponent(sourceId)}`, {
      method: 'DELETE',
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? 'KB source delete failed.');
    }

    renderKbStatus(payload.kb);
    setKbMessage(`Deleted ${title}`, 'success');

    if (reportContent.dataset.jobId) {
      await loadReport(reportContent.dataset.jobId);
    }
  } catch (error) {
    setKbMessage(error.message, 'error');
    button.disabled = false;
    button.dataset.confirm = 'false';
    button.textContent = 'Delete';
  }
}

function renderAnalysisStatus(job) {
  if (!job) {
    return '<span class="status-badge analysis-not-started">Not started</span>';
  }

  const label = `${job.status}${job.stage && job.stage !== job.status ? ` · ${job.stage}` : ''}`;
  return `<span class="status-badge analysis-${escapeHtml(job.status)}">${escapeHtml(label)}</span>`;
}

function latestJobByBundleId(analysisJobs) {
  const jobsByBundleId = new Map();

  for (const job of analysisJobs) {
    if (!jobsByBundleId.has(job.bundleId)) {
      jobsByBundleId.set(job.bundleId, job);
    }
  }

  return jobsByBundleId;
}

function schedulePolling(analysisJobs) {
  const hasActiveJobs = analysisJobs.some((job) => job.status === 'queued' || job.status === 'running');

  if (hasActiveJobs && !pollTimer) {
    pollTimer = setInterval(refreshDashboard, 2500);
  }

  if (!hasActiveJobs && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function loadReport(jobId) {
  if (!jobId) {
    return;
  }

  reportContent.innerHTML = '<p class="empty-report">Loading report</p>';
  reportPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const response = await fetch(`/api/analysis-jobs/${jobId}/report`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? 'Unable to load analysis report.');
    }

    renderReport(payload.report);
  } catch (error) {
    reportContent.innerHTML = `<p class="empty-report error-text">${escapeHtml(error.message)}</p>`;
  }
}

async function deleteBundle(bundleId, filename) {
  setDeleteModalBusy(true);
  setDeleteModalMessage('');
  setFormMessage(`Deleting ${filename}`);

  try {
    const response = await fetch(`/api/bundles/${bundleId}`, {
      method: 'DELETE',
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? 'Delete failed.');
    }

    setFormMessage(`Deleted ${filename}`, 'success');
    closeDeleteModal();

    if (reportContent.dataset.bundleId === bundleId) {
      clearReport();
    }

    await refreshDashboard();
  } catch (error) {
    setDeleteModalMessage(error.message, 'error');
    setFormMessage(error.message, 'error');
  } finally {
    setDeleteModalBusy(false);
  }
}

function openDeleteModal(bundleId, filename) {
  pendingDelete = { bundleId, filename };
  previousFocus = document.activeElement;
  deleteModalFilename.textContent = filename;
  setDeleteModalMessage('');
  setDeleteModalBusy(false);
  deleteModal.hidden = false;
  document.body.classList.add('modal-open');
  cancelDeleteButton.focus();
}

function closeDeleteModal() {
  deleteModal.hidden = true;
  document.body.classList.remove('modal-open');
  pendingDelete = null;
  deleteModalFilename.textContent = '';
  setDeleteModalMessage('');

  if (previousFocus) {
    previousFocus.focus();
    previousFocus = null;
  }
}

function setDeleteModalBusy(isBusy) {
  cancelDeleteButton.disabled = isBusy;
  confirmDeleteButton.disabled = isBusy;
  confirmDeleteButton.textContent = isBusy ? 'Deleting' : 'Delete';
}

function setDeleteModalMessage(message, state) {
  deleteModalMessage.textContent = message;
  deleteModalMessage.classList.remove('error');

  if (state) {
    deleteModalMessage.classList.add(state);
  }
}

function clearReport() {
  delete reportContent.dataset.bundleId;
  delete reportContent.dataset.jobId;
  reportContent.innerHTML = '<p class="empty-report">Completed analysis reports will appear here.</p>';
}

function renderReport(report) {
  reportContent.dataset.bundleId = report.bundleId;
  reportContent.dataset.jobId = report.jobId;
  const summary = report.summary;
  const findingSummary = report.findingSummary ?? {
    total: 0,
    critical: 0,
    warning: 0,
    info: 0,
  };
  const groupSummary = report.groupSummary ?? {
    total: 0,
    critical: 0,
    warning: 0,
    info: 0,
  };

  reportContent.innerHTML = `
    <div class="report-summary">
      <div class="metric">
        <span class="metric-value">${groupSummary.total}</span>
        <span class="metric-label">Groups</span>
      </div>
      <div class="metric">
        <span class="metric-value">${findingSummary.total}</span>
        <span class="metric-label">Findings</span>
      </div>
      <div class="metric">
        <span class="metric-value">${summary.fileCount}</span>
        <span class="metric-label">Files</span>
      </div>
      <div class="metric">
        <span class="metric-value">${summary.directoryCount}</span>
        <span class="metric-label">Directories</span>
      </div>
      <div class="metric">
        <span class="metric-value">${formatBytes(summary.totalBytes)}</span>
        <span class="metric-label">Extracted Size</span>
      </div>
      <div class="metric">
        <span class="metric-value">${summary.totalEntries}</span>
        <span class="metric-label">Entries</span>
      </div>
      ${renderKbMetric(report.kbSummary)}
    </div>

    ${renderFindingGroups(report.findingGroups ?? [], groupSummary)}
    ${renderFindings(report.findings ?? [], findingSummary, report.findingGroups?.length)}

    <div class="report-grid">
      <div>
        <h3>Archive</h3>
        <dl class="report-dl">
          <dt>Filename</dt>
          <dd>${escapeHtml(report.archive.filename)}</dd>
          <dt>Type</dt>
          <dd>${escapeHtml(report.archive.archiveType)}</dd>
          ${renderArchiveMetadata(report.inventory?.metadata)}
          <dt>SHA-256</dt>
          <dd class="mono">${escapeHtml(report.archive.sha256)}</dd>
        </dl>
      </div>
      <div>
        <h3>Longhorn Inventory</h3>
        ${renderLonghornInventory(report.inventory?.longhorn)}
      </div>
      <div>
        <h3>Largest Files</h3>
        ${renderFileList(report.largestFiles)}
      </div>
    </div>

    <div class="report-files">
      <h3>Indexed Files${summary.truncatedFileIndex ? ` · first ${summary.reportFileLimit}` : ''}</h3>
      <div class="file-index-list">
        ${renderFileIndex(report.fileIndex)}
      </div>
    </div>
  `;
}

function renderFindingGroups(groups, summary) {
  return `
    <section class="finding-groups-section" aria-labelledby="findingGroupsTitle">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Correlation</p>
          <h3 id="findingGroupsTitle">Grouped Findings</h3>
        </div>
        <div class="finding-summary" aria-label="Finding group severity summary">
          <span class="severity-dot critical"></span>${summary.critical}
          <span class="severity-dot warning"></span>${summary.warning}
          <span class="severity-dot info"></span>${summary.info}
        </div>
      </div>
      ${
        groups.length
          ? `<div class="finding-group-list">${groups.map(renderFindingGroup).join('')}</div>`
          : '<p class="empty-report">No correlated finding groups detected.</p>'
      }
    </section>
  `;
}

function renderFindingGroup(group) {
  return `
    <article class="finding-group-card finding-${escapeHtml(group.severity)}">
      <div class="finding-card-header">
        <span class="finding-severity">${escapeHtml(group.severity)}</span>
        <span class="finding-category">${escapeHtml(group.relatedFindingIds?.length ?? 0)} linked findings</span>
      </div>
      <h4>${escapeHtml(group.title)}</h4>
      <p>${escapeHtml(group.description)}</p>
      <div class="finding-impact">${escapeHtml(group.impact)}</div>
      ${renderGroupAffected(group.affected)}
      ${renderRecommendedChecks(group.recommendedChecks)}
      ${renderRelatedKb(group.relatedKb)}
      ${renderFindingEvidence(group.evidence)}
    </article>
  `;
}

function renderKbMetric(summary = {}) {
  if (!summary.documentCount) {
    return '';
  }

  return `
    <div class="metric">
      <span class="metric-value">${summary.documentCount}</span>
      <span class="metric-label">KB Docs</span>
    </div>
  `;
}

function renderGroupAffected(affected = []) {
  if (!affected.length) {
    return '';
  }

  return `
    <div class="group-affected">
      ${affected
        .map((item) => {
          const [label, value = ''] = String(item).split(/:\s*/, 2);
          return `
            <span>
              <small>${escapeHtml(label)}</small>
              <strong>${escapeHtml(value)}</strong>
            </span>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderRecommendedChecks(checks = []) {
  if (!checks.length) {
    return '';
  }

  return `
    <div class="recommended-checks">
      <h5>Recommended Checks</h5>
      <ul>
        ${checks.map((check) => `<li>${escapeHtml(check)}</li>`).join('')}
      </ul>
    </div>
  `;
}

function renderRelatedKb(articles = []) {
  if (!articles.length) {
    return '';
  }

  return `
    <div class="related-kb">
      <h5>Related KB</h5>
      <ul>
        ${articles
          .map(
            (article) => `
              <li>
                ${renderKbArticleTitle(article)}
                <span>${escapeHtml(formatKbScore(article.score))}</span>
                <p>${escapeHtml(article.excerpt)}</p>
              </li>
            `,
          )
          .join('')}
      </ul>
    </div>
  `;
}

function renderKbArticleTitle(article) {
  if (isHttpUrl(article.sourceUri)) {
    return `
      <a href="${escapeHtml(article.sourceUri)}" target="_blank" rel="noreferrer">
        ${escapeHtml(article.title)}
      </a>
    `;
  }

  return `<strong class="related-kb-title">${escapeHtml(article.title)}</strong>`;
}

function renderFindings(findings, summary, hasGroups = false) {
  return `
    <section class="findings-section" aria-labelledby="findingsTitle">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Diagnostics</p>
          <h3 id="findingsTitle">${hasGroups ? 'Finding Details' : 'Findings'}</h3>
        </div>
        <div class="finding-summary" aria-label="Finding severity summary">
          <span class="severity-dot critical"></span>${summary.critical}
          <span class="severity-dot warning"></span>${summary.warning}
          <span class="severity-dot info"></span>${summary.info}
        </div>
      </div>
      ${
        findings.length
          ? `<div class="finding-list">${findings.map(renderFinding).join('')}</div>`
          : '<p class="empty-report">No findings detected by current rules.</p>'
      }
    </section>
  `;
}

function renderFinding(finding) {
  const countLabel = Number.isFinite(finding.count) && finding.count > 1 ? ` · ${finding.count} matches` : '';

  return `
    <article class="finding-card finding-${escapeHtml(finding.severity)}">
      <div class="finding-card-header">
        <span class="finding-severity">${escapeHtml(finding.severity)}</span>
        <span class="finding-category">${escapeHtml(finding.category)}</span>
      </div>
      <h4>${escapeHtml(finding.title)}${escapeHtml(countLabel)}</h4>
      <p>${escapeHtml(finding.description)}</p>
      ${renderFindingEvidence(finding.evidence)}
      ${finding.path ? `<div class="finding-path mono">${escapeHtml(finding.path)}</div>` : ''}
    </article>
  `;
}

function renderFindingEvidence(evidence = []) {
  if (!evidence.length) {
    return '';
  }

  return `
    <ul class="finding-evidence">
      ${evidence.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
    </ul>
  `;
}

function renderArchiveMetadata(metadata = {}) {
  const rows = [
    ['Kubernetes', metadata.kubernetesversion],
    ['Created', metadata.bundlecreatedat],
    ['Issue', metadata.issuedescription],
  ].filter(([, value]) => value);

  return rows
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');
}

function renderLonghornInventory(inventory = {}) {
  const rows = [
    ['Volumes', inventory.volumes?.total, inventory.volumes?.unhealthy ? `${inventory.volumes.unhealthy} unhealthy` : 'healthy'],
    ['Replicas', inventory.replicas?.total, inventory.replicas?.notRunning ? `${inventory.replicas.notRunning} not running` : 'running'],
    ['Nodes', inventory.nodes?.total, inventory.nodes?.problematic ? `${inventory.nodes.problematic} with issues` : 'ready'],
    ['Pods', inventory.pods?.total, inventory.pods?.withRestarts ? `${inventory.pods.withRestarts} restarted` : 'steady'],
    ['Events', inventory.events?.total, inventory.events?.warnings ? `${inventory.events.warnings} warnings` : 'normal'],
    ['Logs', inventory.logs?.scannedFiles, inventory.logs?.matchedLines ? `${inventory.logs.matchedLines} matches` : 'quiet'],
  ].filter(([, count]) => Number.isFinite(count));

  if (!rows.length) {
    return '<p class="empty-report">No Longhorn inventory found</p>';
  }

  return `
    <ul class="inventory-list">
      ${rows
        .map(
          ([label, count, detail]) => `
            <li>
              <span>${escapeHtml(label)}</span>
              <strong>${count}</strong>
              <small>${escapeHtml(detail)}</small>
            </li>
          `,
        )
        .join('')}
    </ul>
  `;
}

function renderNameCountList(entries) {
  if (!entries.length) {
    return '<p class="empty-report">No entries found</p>';
  }

  return `
    <ul class="compact-list">
      ${entries
        .map((entry) => `<li><span>${escapeHtml(entry.name)}</span><strong>${entry.count}</strong></li>`)
        .join('')}
    </ul>
  `;
}

function renderFileList(files) {
  if (!files.length) {
    return '<p class="empty-report">No files found</p>';
  }

  return `
    <ul class="compact-list">
      ${files
        .map(
          (file) =>
            `<li><span title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span><strong>${formatBytes(file.size)}</strong></li>`,
        )
        .join('')}
    </ul>
  `;
}

function renderFileIndex(files) {
  if (!files.length) {
    return '<p class="empty-report">No files found</p>';
  }

  return files
    .map(
      (file) => `
        <div class="file-index-row">
          <span title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span>
          <strong>${formatBytes(file.size)}</strong>
        </div>
      `,
    )
    .join('');
}

function productLabel(productType) {
  if (productType === 'longhorn') {
    return 'Longhorn';
  }

  if (productType === 'harvester') {
    return 'Harvester';
  }

  return 'Unknown';
}

function setApiStatus(message, state) {
  apiStatus.textContent = message;
  apiStatus.classList.remove('ready', 'error');

  if (state) {
    apiStatus.classList.add(state);
  }
}

function setFormMessage(message, state) {
  formMessage.textContent = message;
  formMessage.classList.remove('error', 'success');

  if (state) {
    formMessage.classList.add(state);
  }
}

function setKbMessage(message, state) {
  kbMessage.textContent = message;
  kbMessage.classList.remove('error', 'success', 'warning');

  if (state) {
    kbMessage.classList.add(state);
  }
}

function setProgress(value) {
  progressBar.style.width = `${value}%`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatInteger(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat().format(value) : '0';
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatKbScore(score) {
  if (!Number.isFinite(score)) {
    return 'match';
  }

  return `${Math.round(score * 100)}% match`;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
