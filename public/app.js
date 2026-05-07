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

let maxUploadBytes = 0;

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
    await refreshBundles();
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

  refreshButton.addEventListener('click', refreshBundles);
  form.addEventListener('submit', uploadBundle);
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
    setFormMessage(`Uploaded ${payload.bundle.originalFilename}`, 'success');
    form.reset();
    productOptions.querySelector('input[value="longhorn"]').checked = true;
    productOptions.dispatchEvent(new Event('change'));
    updateSelectedFile();
    setProgress(100);
    await refreshBundles();
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

async function refreshBundles() {
  try {
    const response = await fetch('/api/bundles');
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? 'Unable to load uploads.');
    }

    renderBundles(payload.bundles);
  } catch (error) {
    bundleRows.innerHTML = `<tr><td colspan="6" class="empty-cell">${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderBundles(bundles) {
  if (!bundles.length) {
    bundleRows.innerHTML = '<tr><td colspan="6" class="empty-cell">No uploads yet</td></tr>';
    return;
  }

  bundleRows.innerHTML = bundles
    .map(
      (bundle) => `
        <tr>
          <td><strong>${productLabel(bundle.productType)}</strong></td>
          <td class="filename-cell">${escapeHtml(bundle.originalFilename)}</td>
          <td><span class="status-badge">${escapeHtml(bundle.uploadStatus)}</span></td>
          <td>${formatBytes(bundle.fileSize)}</td>
          <td><span class="muted">${formatDate(bundle.createdAt)}</span></td>
          <td><div class="hash" title="${escapeHtml(bundle.sha256)}">${escapeHtml(bundle.sha256)}</div></td>
        </tr>
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
