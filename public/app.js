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

let maxUploadBytes = 0;
let pollTimer = null;

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
    await refreshDashboard();
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
  bundleRows.addEventListener('click', (event) => {
    const reportButton = event.target.closest('[data-report-job-id]');

    if (reportButton) {
      loadReport(reportButton.dataset.reportJobId);
      return;
    }

    const deleteButton = event.target.closest('[data-delete-bundle-id]');

    if (deleteButton) {
      deleteBundle(deleteButton.dataset.deleteBundleId, deleteButton.dataset.filename);
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
  const confirmed = window.confirm(`Delete uploaded bundle "${filename}" and its analysis data?`);

  if (!confirmed) {
    return;
  }

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

    if (reportContent.dataset.bundleId === bundleId) {
      clearReport();
    }

    await refreshDashboard();
  } catch (error) {
    setFormMessage(error.message, 'error');
  }
}

function clearReport() {
  delete reportContent.dataset.bundleId;
  reportContent.innerHTML = '<p class="empty-report">Completed analysis reports will appear here.</p>';
}

function renderReport(report) {
  reportContent.dataset.bundleId = report.bundleId;
  const summary = report.summary;

  reportContent.innerHTML = `
    <div class="report-summary">
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
    </div>

    <div class="report-grid">
      <div>
        <h3>Archive</h3>
        <dl class="report-dl">
          <dt>Filename</dt>
          <dd>${escapeHtml(report.archive.filename)}</dd>
          <dt>Type</dt>
          <dd>${escapeHtml(report.archive.archiveType)}</dd>
          <dt>SHA-256</dt>
          <dd class="mono">${escapeHtml(report.archive.sha256)}</dd>
        </dl>
      </div>
      <div>
        <h3>Top-Level Entries</h3>
        ${renderNameCountList(report.topLevelEntries)}
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
  return productType === 'harvester' ? 'Harvester' : 'Longhorn';
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

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
