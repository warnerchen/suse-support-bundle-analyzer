const apiStatus = document.querySelector('#apiStatus');
const languageControl = document.querySelector('#languageControl');
const languageButton = document.querySelector('#languageButton');
const languageButtonLabel = document.querySelector('#languageButtonLabel');
const languageMenu = document.querySelector('#languageMenu');
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
const evidenceDrawer = document.querySelector('#evidenceDrawer');
const evidenceDrawerTitle = document.querySelector('#evidenceDrawerTitle');
const evidenceDrawerPath = document.querySelector('#evidenceDrawerPath');
const evidenceDrawerMeta = document.querySelector('#evidenceDrawerMeta');
const evidenceDrawerBody = document.querySelector('#evidenceDrawerBody');
const closeEvidenceButton = document.querySelector('#closeEvidenceButton');
const copyEvidencePathButton = document.querySelector('#copyEvidencePathButton');
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

const DEFAULT_LANGUAGE = 'en';
const LANGUAGE_STORAGE_KEY = 'support-bundle-analyzer-language';
const LANGUAGE_OPTIONS = {
  en: 'English',
  'zh-CN': '简体中文',
};
const LOCALES = {
  en: 'en-US',
  'zh-CN': 'zh-CN',
};
const TRANSLATIONS = {
  en: {
    documentTitle: 'SUSE Support Bundle Analyzer',
    brandEyebrow: 'SUSE Technical Support',
    appTitle: 'Support Bundle Analyzer',
    languageLabel: 'Language',
    statusChecking: 'Checking API',
    statusReady: 'Ready',
    statusWarning: 'warning',
    statusBlocked: 'blocked',
    statusApiOffline: 'API offline',
    bundleIntake: 'Bundle Intake',
    uploadTitle: 'Upload Support Bundle',
    limitLabel: ({ size }) => `Limit ${size}`,
    product: 'Product',
    chooseBundleArchive: 'Choose bundle archive',
    noFileSelected: 'No file selected',
    upload: 'Upload',
    queue: 'Queue',
    recentUploads: 'Recent Uploads',
    refresh: 'Refresh',
    refreshRecentUploads: 'Refresh recent uploads',
    filename: 'Filename',
    status: 'Status',
    analysis: 'Analysis',
    size: 'Size',
    uploaded: 'Uploaded',
    report: 'Report',
    delete: 'Delete',
    view: 'View',
    loadingUploads: 'Loading uploads',
    noUploadsYet: 'No uploads yet',
    statusRunningTitle: 'Analysis is running',
    knowledgeBase: 'Knowledge Base',
    kbVectorIndex: 'KB Vector Index',
    productScope: 'Product Scope',
    autoDetect: 'Auto detect',
    expandSamePathLinks: 'Expand same-path links',
    explainUrlImportExpansion: 'Explain URL import expansion',
    expandTooltip:
      'Import the entered URL. For directory-style pages, it will also import document links under the same site and path prefix. Off-site links, static assets, PDFs, and archive files will be skipped. If importing the URL of a single article, please disable Expand same-path links.',
    sourceUrls: 'Source URLs',
    previewUrls: 'Preview URLs',
    markdownFiles: 'Markdown Files',
    chooseFiles: 'Choose files',
    noFilesSelected: 'No files selected',
    selectedFiles: ({ count, size }) => `${count} file${count === 1 ? '' : 's'} · ${size}`,
    previewFiles: 'Preview Files',
    indexStatus: 'Index Status',
    loadingKbStatus: 'Loading KB status',
    sources: 'Sources',
    filterKbSources: 'Filter KB sources by product',
    allProducts: 'All products',
    unknown: 'Unknown',
    loadingKbSources: 'Loading KB sources',
    fileIndexReport: 'File Index Report',
    reportsWillAppear: 'Completed analysis reports will appear here.',
    deleteBundle: 'Delete Bundle',
    deleteUploadedBundle: 'Delete uploaded support bundle?',
    deleteUploadedBundleDescription: 'The uploaded archive and related analysis data will be removed.',
    cancel: 'Cancel',
    deleting: 'Deleting',
    evidence: 'Evidence',
    filePreview: 'File Preview',
    loadingFile: 'Loading file',
    loadingEvidence: 'Loading evidence',
    previewUnavailable: 'Preview Unavailable',
    closeEvidencePreview: 'Close evidence preview',
    copyPath: 'Copy path',
    selectReportPath: 'Select a report path to preview evidence.',
    path: 'Path',
    copied: 'copied',
    copyFailed: 'copy failed',
    partialPreview: 'partial preview',
    linesRange: ({ start, end }) => `lines ${start}-${end}`,
    fileCannotPreview: 'This file cannot be previewed.',
    apiUnavailable: 'API unavailable',
    unableToLoadKbStatus: 'Unable to load KB status.',
    kbStatusUnavailable: 'KB status unavailable',
    kbSourcesUnavailable: 'KB sources unavailable',
    enterKbUrl: 'Enter at least one KB URL.',
    previewingKbUrls: 'Previewing KB URLs',
    kbPreviewFailed: 'KB preview failed.',
    selectMarkdownFile: 'Select at least one Markdown file.',
    notMarkdownFile: ({ name }) => `${name} is not a Markdown file.`,
    previewingMarkdownFiles: 'Previewing Markdown files',
    kbFilePreviewFailed: 'KB file preview failed.',
    previewBeforeImport: 'Preview the KB source before importing.',
    importingKbSources: 'Importing previewed KB sources',
    kbImportFailed: 'KB import failed.',
    kbFileImportFailed: 'KB file import failed.',
    noDocumentsImported: ({ message, failureCount }) =>
      `No documents imported. ${message ?? `${failureCount} failed.`}`,
    importedKb: ({ documents, chunks, failureCount, firstFailure }) =>
      `Imported ${documents} document${documents === 1 ? '' : 's'} and indexed ${chunks} chunk${chunks === 1 ? '' : 's'}${
        failureCount ? `; ${failureCount} failed${firstFailure ? `: ${firstFailure}` : ''}` : ''
      }`,
    previewNoImportable: 'Preview finished, but no importable KB documents were found.',
    previewReady: ({ importable, warnings, blockedOrFailed }) =>
      `Preview ready: ${importable} importable document${importable === 1 ? '' : 's'}${
        warnings ? `, ${warnings} with warnings` : ''
      }${blockedOrFailed ? `, ${blockedOrFailed} blocked or failed` : ''}.`,
    importPreview: 'Import Preview',
    import: ({ count }) => `Import ${count || ''}`.trim(),
    noDocumentsPreviewed: 'No documents could be previewed.',
    urlsChecked: ({ count, importable, blockedOrFailed }) =>
      `${count} URLs checked, ${importable} importable, ${blockedOrFailed} blocked or failed.`,
    filesChecked: ({ count, importable, blockedOrFailed }) =>
      `${count} files checked, ${importable} importable, ${blockedOrFailed} blocked or failed.`,
    chars: ({ count }) => `${count} chars`,
    chunks: ({ count }) => `${count} chunk${count === 1 ? '' : 's'}`,
    noReadableExcerpt: 'No readable excerpt detected.',
    unknownSource: 'Unknown source',
    serverInvalidResponse: 'Server returned an invalid response.',
    uploadFailed: 'Upload failed.',
    networkUploadError: 'Network error during upload.',
    unableToLoadUploads: 'Unable to load uploads.',
    unableToLoadAnalysisJobs: 'Unable to load analysis jobs.',
    noKbImported: 'No KB imported yet',
    documents: 'Documents',
    chunksLabel: 'Chunks',
    dims: ({ count }) => `${count} dims`,
    updatedAt: ({ date }) => `Updated ${date}`,
    noKbSourcesMatch: 'No KB sources match this filter',
    noKbSourcesImported: 'No KB sources imported yet',
    confirm: 'Confirm',
    confirmDeletion: ({ title }) => `Confirm deletion for ${title}.`,
    deletingSource: ({ title }) => `Deleting ${title}`,
    kbSourceDeleteFailed: 'KB source delete failed.',
    deletedSource: ({ title }) => `Deleted ${title}`,
    notStarted: 'Not started',
    loadingReport: 'Loading report',
    unableToLoadReport: 'Unable to load analysis report.',
    unableToLoadEvidenceFile: 'Unable to load evidence file.',
    deleteFailed: 'Delete failed.',
    chooseProduct: 'Choose Longhorn or Harvester.',
    selectBundleArchive: 'Select a support bundle archive.',
    fileTooLarge: ({ size }) => `File is larger than ${size}.`,
    uploading: 'Uploading',
    uploadQueued: ({ filename }) => `Uploaded ${filename}; analysis queued`,
    deletingBundle: ({ filename }) => `Deleting ${filename}`,
    deletedBundle: ({ filename }) => `Deleted ${filename}`,
    groups: 'Groups',
    findings: 'Findings',
    files: 'Files',
    directories: 'Directories',
    extractedSize: 'Extracted Size',
    entries: 'Entries',
    kbDocs: 'KB Docs',
    archive: 'Archive',
    type: 'Type',
    created: 'Created',
    issueDescription: 'Issue Description',
    longhornInventory: 'Longhorn Inventory',
    largestFiles: 'Largest Files',
    indexedFiles: 'Indexed Files',
    indexedFilesLimited: ({ limit }) => `Indexed Files · first ${limit}`,
    correlation: 'Correlation',
    groupedFindings: 'Grouped Findings',
    findingGroupSeveritySummary: 'Finding group severity summary',
    noFindingGroups: 'No correlated finding groups detected.',
    linkedFindings: ({ count }) => `${count} linked findings`,
    recommendedChecks: 'Recommended Checks',
    relatedKb: 'Related KB',
    diagnostics: 'Diagnostics',
    findingDetails: 'Finding Details',
    findingSeveritySummary: 'Finding severity summary',
    noFindings: 'No findings detected by current rules.',
    matches: ({ count }) => ` · ${count} matches`,
    noLonghornInventory: 'No Longhorn inventory found',
    volumes: 'Volumes',
    replicas: 'Replicas',
    nodes: 'Nodes',
    pods: 'Pods',
    events: 'Events',
    logs: 'Logs',
    noEntriesFound: 'No entries found',
    noFilesFound: 'No files found',
    match: 'match',
    percentMatch: ({ percent }) => `${percent}% match`,
    healthy: 'healthy',
    running: 'running',
    ready: 'ready',
    steady: 'steady',
    normal: 'normal',
    quiet: 'quiet',
    unhealthy: ({ count }) => `${count} unhealthy`,
    notRunning: ({ count }) => `${count} not running`,
    withIssues: ({ count }) => `${count} with issues`,
    restarted: ({ count }) => `${count} restarted`,
    warnings: ({ count }) => `${count} warnings`,
    logMatches: ({ count }) => `${count} matches`,
  },
  'zh-CN': {
    documentTitle: 'SUSE Support Bundle 分析器',
    brandEyebrow: 'SUSE 技术支持',
    appTitle: 'Support Bundle 分析器',
    languageLabel: '语言',
    statusChecking: '检查 API',
    statusReady: '就绪',
    statusWarning: '警告',
    statusBlocked: '被阻止',
    statusApiOffline: 'API 离线',
    bundleIntake: 'Bundle 导入',
    uploadTitle: '上传 Support Bundle',
    limitLabel: ({ size }) => `限制 ${size}`,
    product: '产品',
    chooseBundleArchive: '选择 Bundle 压缩包',
    noFileSelected: '未选择文件',
    upload: '上传',
    queue: '队列',
    recentUploads: '最近上传',
    refresh: '刷新',
    refreshRecentUploads: '刷新最近上传',
    filename: '文件名',
    status: '状态',
    analysis: '分析',
    size: '大小',
    uploaded: '上传时间',
    report: '报告',
    delete: '删除',
    view: '查看',
    loadingUploads: '正在加载上传记录',
    noUploadsYet: '还没有上传记录',
    statusRunningTitle: '分析正在运行',
    knowledgeBase: '知识库',
    kbVectorIndex: 'KB 向量索引',
    productScope: '产品范围',
    autoDetect: '自动检测',
    expandSamePathLinks: '扩展同路径链接',
    explainUrlImportExpansion: '解释 URL 导入扩展规则',
    expandTooltip:
      '导入输入的 URL。对于目录型页面，也会导入同一站点和同一路径前缀下的文档链接。站外链接、静态资源、PDF 和压缩文件会被跳过。如果导入的是单篇文章 URL，请关闭扩展同路径链接。',
    sourceUrls: '来源 URL',
    previewUrls: '预览 URL',
    markdownFiles: 'Markdown 文件',
    chooseFiles: '选择文件',
    noFilesSelected: '未选择文件',
    selectedFiles: ({ count, size }) => `${count} 个文件 · ${size}`,
    previewFiles: '预览文件',
    indexStatus: '索引状态',
    loadingKbStatus: '正在加载 KB 状态',
    sources: '来源',
    filterKbSources: '按产品过滤 KB 来源',
    allProducts: '全部产品',
    unknown: '未知',
    loadingKbSources: '正在加载 KB 来源',
    fileIndexReport: '文件索引报告',
    reportsWillAppear: '完成的分析报告会显示在这里。',
    deleteBundle: '删除 Bundle',
    deleteUploadedBundle: '删除已上传的 support bundle？',
    deleteUploadedBundleDescription: '上传的压缩包和相关分析数据都会被移除。',
    cancel: '取消',
    deleting: '删除中',
    evidence: '证据',
    filePreview: '文件预览',
    loadingFile: '正在加载文件',
    loadingEvidence: '正在加载证据',
    previewUnavailable: '无法预览',
    closeEvidencePreview: '关闭证据预览',
    copyPath: '复制路径',
    selectReportPath: '选择报告路径来预览证据。',
    path: '路径',
    copied: '已复制',
    copyFailed: '复制失败',
    partialPreview: '部分预览',
    linesRange: ({ start, end }) => `第 ${start}-${end} 行`,
    fileCannotPreview: '该文件无法预览。',
    apiUnavailable: 'API 不可用',
    unableToLoadKbStatus: '无法加载 KB 状态。',
    kbStatusUnavailable: 'KB 状态不可用',
    kbSourcesUnavailable: 'KB 来源不可用',
    enterKbUrl: '请输入至少一个 KB URL。',
    previewingKbUrls: '正在预览 KB URL',
    kbPreviewFailed: 'KB 预览失败。',
    selectMarkdownFile: '请选择至少一个 Markdown 文件。',
    notMarkdownFile: ({ name }) => `${name} 不是 Markdown 文件。`,
    previewingMarkdownFiles: '正在预览 Markdown 文件',
    kbFilePreviewFailed: 'KB 文件预览失败。',
    previewBeforeImport: '请先预览 KB 来源，再执行导入。',
    importingKbSources: '正在导入预览过的 KB 来源',
    kbImportFailed: 'KB 导入失败。',
    kbFileImportFailed: 'KB 文件导入失败。',
    noDocumentsImported: ({ message, failureCount }) =>
      `没有导入任何文档。${message ?? `${failureCount} 个失败。`}`,
    importedKb: ({ documents, chunks, failureCount, firstFailure }) =>
      `已导入 ${documents} 个文档，并索引 ${chunks} 个 chunk${
        failureCount ? `；${failureCount} 个失败${firstFailure ? `：${firstFailure}` : ''}` : ''
      }`,
    previewNoImportable: '预览完成，但没有找到可导入的 KB 文档。',
    previewReady: ({ importable, warnings, blockedOrFailed }) =>
      `预览完成：${importable} 个文档可导入${
        warnings ? `，${warnings} 个有警告` : ''
      }${blockedOrFailed ? `，${blockedOrFailed} 个被阻止或失败` : ''}。`,
    importPreview: '导入预览',
    import: ({ count }) => `导入${count ? ` ${count}` : ''}`,
    noDocumentsPreviewed: '没有可预览的文档。',
    urlsChecked: ({ count, importable, blockedOrFailed }) =>
      `已检查 ${count} 个 URL，${importable} 个可导入，${blockedOrFailed} 个被阻止或失败。`,
    filesChecked: ({ count, importable, blockedOrFailed }) =>
      `已检查 ${count} 个文件，${importable} 个可导入，${blockedOrFailed} 个被阻止或失败。`,
    chars: ({ count }) => `${count} 字符`,
    chunks: ({ count }) => `${count} 个 chunk`,
    noReadableExcerpt: '未检测到可读摘要。',
    unknownSource: '未知来源',
    serverInvalidResponse: '服务器返回了无效响应。',
    uploadFailed: '上传失败。',
    networkUploadError: '上传时发生网络错误。',
    unableToLoadUploads: '无法加载上传记录。',
    unableToLoadAnalysisJobs: '无法加载分析任务。',
    noKbImported: '尚未导入 KB',
    documents: '文档',
    chunksLabel: '分块',
    dims: ({ count }) => `${count} 维`,
    updatedAt: ({ date }) => `更新时间 ${date}`,
    noKbSourcesMatch: '没有匹配该过滤条件的 KB 来源',
    noKbSourcesImported: '尚未导入 KB 来源',
    confirm: '确认',
    confirmDeletion: ({ title }) => `确认删除 ${title}。`,
    deletingSource: ({ title }) => `正在删除 ${title}`,
    kbSourceDeleteFailed: 'KB 来源删除失败。',
    deletedSource: ({ title }) => `已删除 ${title}`,
    notStarted: '未开始',
    loadingReport: '正在加载报告',
    unableToLoadReport: '无法加载分析报告。',
    unableToLoadEvidenceFile: '无法加载证据文件。',
    deleteFailed: '删除失败。',
    chooseProduct: '请选择 Longhorn 或 Harvester。',
    selectBundleArchive: '请选择 support bundle 压缩包。',
    fileTooLarge: ({ size }) => `文件大于 ${size}。`,
    uploading: '正在上传',
    uploadQueued: ({ filename }) => `已上传 ${filename}；分析已排队`,
    deletingBundle: ({ filename }) => `正在删除 ${filename}`,
    deletedBundle: ({ filename }) => `已删除 ${filename}`,
    groups: '分组',
    findings: '发现项',
    files: '文件',
    directories: '目录',
    extractedSize: '解压大小',
    entries: '条目',
    kbDocs: 'KB 文档',
    archive: '归档',
    type: '类型',
    created: '创建时间',
    issueDescription: '问题描述',
    longhornInventory: 'Longhorn 清单',
    largestFiles: '最大文件',
    indexedFiles: '已索引文件',
    indexedFilesLimited: ({ limit }) => `已索引文件 · 前 ${limit} 个`,
    correlation: '关联分析',
    groupedFindings: '发现项分组',
    findingGroupSeveritySummary: '发现项分组严重性汇总',
    noFindingGroups: '当前没有检测到关联发现项分组。',
    linkedFindings: ({ count }) => `${count} 个关联发现项`,
    recommendedChecks: '建议检查',
    relatedKb: '相关 KB',
    diagnostics: '诊断',
    findingDetails: '发现项详情',
    findingSeveritySummary: '发现项严重性汇总',
    noFindings: '当前规则没有检测到发现项。',
    matches: ({ count }) => ` · ${count} 个匹配`,
    noLonghornInventory: '没有找到 Longhorn 清单',
    volumes: '卷',
    replicas: '副本',
    nodes: '节点',
    pods: 'Pod',
    events: '事件',
    logs: '日志',
    noEntriesFound: '没有找到条目',
    noFilesFound: '没有找到文件',
    match: '匹配',
    percentMatch: ({ percent }) => `${percent}% 匹配`,
    healthy: '健康',
    running: '运行中',
    ready: '就绪',
    steady: '稳定',
    normal: '正常',
    quiet: '安静',
    unhealthy: ({ count }) => `${count} 个不健康`,
    notRunning: ({ count }) => `${count} 个未运行`,
    withIssues: ({ count }) => `${count} 个有问题`,
    restarted: ({ count }) => `${count} 个已重启`,
    warnings: ({ count }) => `${count} 个警告`,
    logMatches: ({ count }) => `${count} 个匹配`,
  },
};
const STATUS_LABELS = {
  en: {
    uploaded: 'Uploaded',
    queued: 'Queued',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    waiting: 'waiting',
    preparing: 'preparing',
    'listing archive': 'listing archive',
    'extracting archive': 'extracting archive',
    'indexing files': 'indexing files',
    'running product checks': 'running product checks',
  },
  'zh-CN': {
    uploaded: '已上传',
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    waiting: '等待中',
    preparing: '准备中',
    'listing archive': '读取归档列表',
    'extracting archive': '解压中',
    'indexing files': '索引文件中',
    'running product checks': '执行产品检查',
  },
};
const SEVERITY_LABELS = {
  en: {
    critical: 'critical',
    warning: 'warning',
    info: 'info',
  },
  'zh-CN': {
    critical: '严重',
    warning: '警告',
    info: '信息',
  },
};
const CATEGORY_LABELS = {
  en: {},
  'zh-CN': {
    Collection: '采集',
    Monitoring: '监控',
    'Kubernetes Events': 'Kubernetes 事件',
    'Longhorn Logs': 'Longhorn 日志',
    'Longhorn Volume': 'Longhorn 卷',
    'Longhorn Replica': 'Longhorn 副本',
    'Longhorn Node': 'Longhorn 节点',
    'Longhorn Pod': 'Longhorn Pod',
  },
};
const FINDING_TEXT = {
  'zh-CN': {
    'longhorn-manager-observed-panic': {
      title: 'Longhorn manager 观察到 panic',
      description: 'Longhorn manager 日志包含 Kubernetes runtime panic 条目。建议检查 manager 稳定性和周边堆栈。',
    },
    'longhorn-log-replica-scheduling-storage': {
      title: '副本调度遇到存储压力',
      description: 'Longhorn manager 日志包含副本创建预检查失败，原因可能与磁盘空间不足或磁盘不可用有关。',
    },
    'longhorn-log-csi-connection-refused': {
      title: 'CSI 组件出现连接拒绝错误',
      description: 'Longhorn CSI 日志包含连接拒绝错误，通常发生在 CSI socket 或 sidecar 尚未就绪时。',
    },
    'longhorn-log-webhook-connection-refused': {
      title: 'Longhorn webhook endpoint 出现连接拒绝错误',
      description: 'Longhorn manager 日志包含本地 webhook endpoint 健康检查失败，可能发生在转换或准入 webhook 尚未就绪时。',
    },
    'longhorn-log-error-lines': {
      title: 'Longhorn 日志包含 error 级别行',
      description: '一个或多个 Longhorn 日志文件包含 error 级别消息。建议查看证据行中的首批匹配文件。',
    },
    'longhorn-bundle-generation-errors': {
      title: 'Support bundle 采集存在错误',
      description: 'Bundle 生成器报告部分资源或 Pod 日志无法采集，因此分析结果可能缺少这些细节。',
    },
    'longhorn-prometheus-alerts-invalid-json': {
      title: 'Prometheus alerts 文件无法解析',
      description: 'Support bundle 包含 prometheus-alerts.json，但它不是合法 JSON。',
    },
    'longhorn-pods-with-container-restarts': {
      title: 'Longhorn Pod 存在容器重启',
      description: '一个或多个 Longhorn Pod 报告了非零容器重启次数。',
    },
    'longhorn-warning-events': {
      title: 'longhorn-system 中发现 Warning 事件',
      description: 'Kubernetes 在 Longhorn namespace 中记录了 Warning 事件。',
    },
  },
};
const GROUP_TEXT = {
  'zh-CN': {
    'longhorn-manager-stability': {
      title: 'Longhorn manager 稳定性需要关注',
      description: 'Longhorn manager 是主要的协调循环。panic 或持续 error 日志可能解释卷、副本或 instance-manager 状态异常。',
      impact: '管理操作可能失败或延迟，并在卷、副本和 webhook 上表现为次生症状。',
      recommendedChecks: [
        '检查 panic 堆栈和周边的 manager 日志行。',
        '将 Longhorn manager 镜像/版本与该版本的已知问题进行对比。',
        '检查节点或 webhook readiness 问题是否发生在同一时间段。',
      ],
    },
    'longhorn-volume-replica-health': {
      title: '卷和副本健康状态存在关联',
      description: 'Longhorn 报告了不健康卷或未运行副本。这两类问题通常相关，建议一起调查。',
      impact: '受影响的 workload 可能出现副本冗余下降、attach 问题，或恢复流程无法完成。',
      recommendedChecks: [
        '同时打开列出的卷 YAML 和副本 YAML 证据。',
        '确认停止的副本是否属于这些不健康卷。',
        '在强制恢复前，先检查节点调度、磁盘容量和副本 rebuild 事件。',
      ],
    },
    'longhorn-replica-scheduling-capacity': {
      title: '副本调度受容量或磁盘可用性限制',
      description: 'Manager 日志显示副本创建预检查失败，原因是候选磁盘或节点不可用。',
      impact: 'Longhorn 可能无法恢复期望副本数，使卷保持 degraded 或 rebuild 卡住。',
      recommendedChecks: [
        '检查空闲空间、保留空间、磁盘标签、节点选择器，以及 Longhorn 节点上的调度禁用状态。',
        '对比受影响卷大小和候选节点上的可用磁盘容量。',
        '在重试副本调度前，先解决节点前置条件问题。',
      ],
    },
    'longhorn-node-prerequisites': {
      title: 'Longhorn 节点前置条件未满足',
      description: '一个或多个 Longhorn 节点条件显示缺少包、缺少内核模块、readiness 问题或影响 Longhorn 的主机服务问题。',
      impact: 'Longhorn 可能避免在这些节点上调度副本，或在存储操作中失败，并报告冗余下降。',
      recommendedChecks: [
        '安装或修复 nodes.yaml 中报告的缺失依赖包。',
        '加载所需内核模块；如果该功能有意不用，则检查 Longhorn 设置。',
        '在这些节点上执行 attach 或 rebuild 前，先调查 multipathd 相关发现项。',
      ],
    },
    'longhorn-control-plane-endpoints': {
      title: 'Longhorn 控制面 endpoint 出现连接失败',
      description: '日志显示本地 webhook 或 CSI socket 连接失败。这通常发生在启动期间，但反复出现会影响协调和 Kubernetes 存储调用。',
      impact: '准入、转换或 CSI 操作可能在相关 endpoint 健康前暂时失败。',
      recommendedChecks: [
        '检查 endpoint 错误是否与 Pod 重启或 manager 启动窗口重合。',
        '确认 webhook 和 CSI sidecar Pod 在错误时间段后处于 Ready。',
      ],
    },
    'longhorn-pod-restarts': {
      title: '采集窗口内 Longhorn Pod 发生重启',
      description: '非零重启次数可能解释临时连接错误、日志缺失或控制面抖动。',
      impact: '反复重启可能中断 CSI、manager、engine image 或 instance-manager 职责。',
      recommendedChecks: [
        '将重启次数与 manager panic 和 endpoint 问题一起查看。',
        '优先打开重启次数最高的 Pod YAML 和相关容器日志。',
      ],
    },
    'longhorn-monitoring-alerts': {
      title: '监控告警正在触发',
      description: 'Bundle 包含正在 firing 且带有可操作 severity label 的 Prometheus 告警。',
      impact: 'Alertmanager 已检测到症状，应与 Longhorn 资源状态进行对比。',
      recommendedChecks: [
        '将告警时间戳与 Longhorn manager 和 Kubernetes event 时间线对齐查看。',
        '如果 prometheus-alerts.json 中包含 runbook URL，请结合 runbook 检查。',
      ],
    },
    'longhorn-collection-gaps': {
      title: 'Support bundle 存在采集缺口',
      description: 'Support bundle 生成器无法采集所有请求的 API 资源或 Pod 日志。',
      impact: '报告仍然有价值，但某个日志或资源不存在不能被视为健康证明。',
      recommendedChecks: [
        '在判断某个资源不可用前，先查看 bundleGenerationError.log。',
        '如果缺失日志对 case 很关键，请重新采集 bundle 或直接查询该 Pod。',
      ],
    },
  },
};
const EVIDENCE_LABELS = {
  'zh-CN': {
    Robustness: '健壮性',
    State: '状态',
    'Current node': '当前节点',
    'Current state': '当前状态',
    Type: '类型',
    Status: '状态',
    Reason: '原因',
    Message: '消息',
    Phase: '阶段',
    Severity: '严重性',
    Panics: 'Panics',
    'Error lines': 'Error 行',
    'Log files scanned': '已扫描日志文件',
    'Unhealthy volumes': '不健康卷',
    'Replicas not running': '未运行副本',
    'Total volumes': '总卷数',
    'Total replicas': '总副本数',
    'Scheduling log matches': '调度日志匹配',
    'Problematic nodes': '问题节点',
    'Total Longhorn nodes': 'Longhorn 节点总数',
    'Node findings': '节点发现项',
    'Webhook matches': 'Webhook 匹配',
    'CSI socket matches': 'CSI socket 匹配',
    'Pods with restarts': '发生重启的 Pod',
    'Total Longhorn pods': 'Longhorn Pod 总数',
    'Firing alerts': '触发中告警',
    'Collection errors': '采集错误',
  },
};

let maxUploadBytes = 0;
let pollTimer = null;
let pendingDelete = null;
let previousFocus = null;
let pendingKbImport = null;
let kbSources = [];
let currentEvidencePath = '';
let latestBundles = [];
let latestAnalysisJobs = [];
let latestKbStatus = null;
let currentReport = null;
let apiStatusKey = 'statusChecking';
let apiStatusState = null;
let currentLanguage = loadLanguagePreference();

await initialize();

async function initialize() {
  applyLanguage();
  bindEvents();

  try {
    const response = await fetch('/api/products');
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? 'API unavailable');
    }

    maxUploadBytes = payload.maxUploadBytes;
    renderUploadLimit();
    setApiStatus('statusReady', 'ready');
    await Promise.all([refreshDashboard(), loadKbStatus()]);
  } catch (error) {
    setApiStatus('statusApiOffline', 'error');
    setFormMessage(error.message, 'error');
  }
}

function bindEvents() {
  languageButton.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleLanguageMenu();
  });

  languageButton.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openLanguageMenu();
      focusLanguageOption(currentLanguage);
    }
  });

  languageMenu.addEventListener('click', (event) => {
    const option = event.target.closest('[data-language-option]');
    if (!option) {
      return;
    }
    setLanguage(option.dataset.languageOption);
    closeLanguageMenu();
    languageButton.focus();
  });

  languageMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLanguageMenu();
      languageButton.focus();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusAdjacentLanguageOption(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusLanguageOption(event.key === 'Home' ? getLanguageOptionValues()[0] : getLanguageOptionValues().at(-1));
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      const option = document.activeElement?.closest?.('[data-language-option]');
      if (option) {
        event.preventDefault();
        setLanguage(option.dataset.languageOption);
        closeLanguageMenu();
        languageButton.focus();
      }
    }
  });

  document.addEventListener('click', (event) => {
    if (!languageControl.contains(event.target)) {
      closeLanguageMenu();
    }
  });

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

  reportContent.addEventListener('click', (event) => {
    const previewButton = event.target.closest('[data-preview-path]');

    if (previewButton) {
      openEvidencePreview({
        path: previewButton.dataset.previewPath,
        lineStart: toOptionalNumber(previewButton.dataset.lineStart),
        lineEnd: toOptionalNumber(previewButton.dataset.lineEnd),
        matchText: previewButton.dataset.matchText || '',
      });
    }
  });
  closeEvidenceButton.addEventListener('click', closeEvidenceDrawer);
  copyEvidencePathButton.addEventListener('click', copyEvidencePath);
  evidenceDrawer.addEventListener('click', (event) => {
    if (event.target === evidenceDrawer) {
      closeEvidenceDrawer();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !languageMenu.hidden) {
      closeLanguageMenu();
      languageButton.focus();
      return;
    }

    if (event.key === 'Escape' && !evidenceDrawer.hidden) {
      closeEvidenceDrawer();
      return;
    }

    if (event.key === 'Escape' && !deleteModal.hidden && !confirmDeleteButton.disabled) {
      closeDeleteModal();
    }
  });
}

function loadLanguagePreference() {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return stored in TRANSLATIONS ? stored : DEFAULT_LANGUAGE;
}

function getLanguageOptionValues() {
  return Object.keys(LANGUAGE_OPTIONS);
}

function setLanguage(language) {
  const nextLanguage = language in TRANSLATIONS ? language : DEFAULT_LANGUAGE;

  if (currentLanguage === nextLanguage) {
    syncLanguageControl();
    return;
  }

  currentLanguage = nextLanguage;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, currentLanguage);
  applyLanguage();
}

function toggleLanguageMenu() {
  if (languageMenu.hidden) {
    openLanguageMenu();
  } else {
    closeLanguageMenu();
  }
}

function openLanguageMenu() {
  languageMenu.hidden = false;
  syncLanguageControl();
}

function closeLanguageMenu() {
  languageMenu.hidden = true;
  syncLanguageControl();
}

function syncLanguageControl() {
  const isOpen = !languageMenu.hidden;
  languageControl.classList.toggle('open', isOpen);
  languageButton.setAttribute('aria-expanded', String(isOpen));
  languageButtonLabel.textContent = LANGUAGE_OPTIONS[currentLanguage] ?? LANGUAGE_OPTIONS[DEFAULT_LANGUAGE];

  for (const option of languageMenu.querySelectorAll('[data-language-option]')) {
    const selected = option.dataset.languageOption === currentLanguage;
    option.setAttribute('aria-selected', String(selected));
    option.tabIndex = isOpen && selected ? 0 : -1;
  }
}

function focusLanguageOption(language) {
  const options = [...languageMenu.querySelectorAll('[data-language-option]')];
  const option = options.find((item) => item.dataset.languageOption === language) ?? options[0];
  option?.focus();
}

function focusAdjacentLanguageOption(offset) {
  const options = [...languageMenu.querySelectorAll('[data-language-option]')];
  if (!options.length) {
    return;
  }

  const activeIndex = options.indexOf(document.activeElement);
  const selectedIndex = options.findIndex((option) => option.dataset.languageOption === currentLanguage);
  const currentIndex = activeIndex >= 0 ? activeIndex : Math.max(selectedIndex, 0);
  const nextIndex = (currentIndex + offset + options.length) % options.length;
  options[nextIndex].focus();
}

function t(key, params = {}) {
  const value = TRANSLATIONS[currentLanguage]?.[key] ?? TRANSLATIONS[DEFAULT_LANGUAGE][key] ?? key;

  if (typeof value === 'function') {
    return value(params);
  }

  return String(value).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => params[name] ?? '');
}

function applyLanguage() {
  document.documentElement.lang = currentLanguage;
  document.title = t('documentTitle');

  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }

  for (const element of document.querySelectorAll('[data-i18n-title]')) {
    element.title = t(element.dataset.i18nTitle);
  }

  for (const element of document.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  }

  syncLanguageControl();
  renderUploadLimit();
  setApiStatus(apiStatusKey, apiStatusState);
  updateSelectedFile({ clearFeedback: false });
  updateSelectedKbFiles({ clearPreviewPanel: false });

  if (latestBundles.length || latestAnalysisJobs.length) {
    renderBundles(latestBundles, latestJobByBundleId(latestAnalysisJobs));
  }

  if (latestKbStatus) {
    renderKbStatus(latestKbStatus);
  }

  if (currentReport) {
    renderReport(currentReport);
  } else if (!reportContent.dataset.jobId) {
    clearReport();
  }
}

function renderUploadLimit() {
  uploadLimit.textContent = maxUploadBytes ? t('limitLabel', { size: formatBytes(maxUploadBytes) }) : '';
}

function updateSelectedFile({ clearFeedback = true } = {}) {
  const file = fileInput.files?.[0];
  fileName.textContent = file ? `${file.name} · ${formatBytes(file.size)}` : t('noFileSelected');

  if (clearFeedback) {
    setFormMessage('');
    setProgress(0);
  }
}

function updateSelectedKbFiles({ clearPreviewPanel = true } = {}) {
  const files = [...(kbFileInput.files ?? [])];

  if (clearPreviewPanel) {
    clearKbPreview();
  }

  if (!files.length) {
    kbFileName.textContent = t('noFilesSelected');
    return;
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  kbFileName.textContent = t('selectedFiles', { count: files.length, size: formatBytes(totalBytes) });
  setKbMessage('');
}

async function uploadBundle(event) {
  event.preventDefault();

  const file = fileInput.files?.[0];
  const productType = new FormData(form).get('productType');

  if (!productType) {
    setFormMessage(t('chooseProduct'), 'error');
    return;
  }

  if (!file) {
    setFormMessage(t('selectBundleArchive'), 'error');
    return;
  }

  if (maxUploadBytes && file.size > maxUploadBytes) {
    setFormMessage(t('fileTooLarge', { size: formatBytes(maxUploadBytes) }), 'error');
    return;
  }

  submitButton.disabled = true;
  setFormMessage(t('uploading'));
  setProgress(1);

  const formData = new FormData();
  formData.append('productType', productType);
  formData.append('bundleFile', file);

  try {
    const payload = await sendWithProgress('/api/bundles', formData, setProgress);
    setProgress(100);
    setFormMessage(t('uploadQueued', { filename: payload.bundle.originalFilename }), 'success');
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
      throw new Error(payload.error?.message ?? t('unableToLoadKbStatus'));
    }

    renderKbStatus(payload.kb);
  } catch (error) {
    setKbMessage(error.message, 'error');
    kbStats.innerHTML = `<p class="empty-report">${escapeHtml(t('kbStatusUnavailable'))}</p>`;
    kbSourceList.innerHTML = `<p class="empty-report">${escapeHtml(t('kbSourcesUnavailable'))}</p>`;
  }
}

async function previewKbUrls(event) {
  event.preventDefault();

  const urls = kbUrlInput.value
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (!urls.length) {
    setKbMessage(t('enterKbUrl'), 'error');
    return;
  }

  kbImportButton.disabled = true;
  clearKbPreview();
  setKbMessage(t('previewingKbUrls'));

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
      throw new Error(payload.error?.message ?? t('kbPreviewFailed'));
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
    setKbMessage(t('selectMarkdownFile'), 'error');
    return;
  }

  const invalidFile = files.find((file) => !/\.(md|markdown)$/i.test(file.name));

  if (invalidFile) {
    setKbMessage(t('notMarkdownFile', { name: invalidFile.name }), 'error');
    return;
  }

  kbFileImportButton.disabled = true;
  clearKbPreview();
  setKbMessage(t('previewingMarkdownFiles'));

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
      throw new Error(payload.error?.message ?? t('kbFilePreviewFailed'));
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
    setKbMessage(t('previewBeforeImport'), 'error');
    return;
  }

  const confirmButton = kbPreviewPanel.querySelector('[data-confirm-kb-import]');
  const cancelButton = kbPreviewPanel.querySelector('[data-cancel-kb-preview]');
  confirmButton.disabled = true;
  cancelButton.disabled = true;
  setKbMessage(t('importingKbSources'));

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
    throw new Error(payload.error?.message ?? t('kbImportFailed'));
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
    throw new Error(payload.error?.message ?? t('kbFileImportFailed'));
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
    setKbMessage(t('noDocumentsImported', { message: firstFailure, failureCount }), 'error');
  } else {
    setKbMessage(
      t('importedKb', { documents: imported, chunks, failureCount, firstFailure }),
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
    setKbMessage(t('previewNoImportable'), 'error');
    return;
  }

  setKbMessage(
    t('previewReady', { importable, warnings, blockedOrFailed: blocked + failures }),
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
        <div class="kb-field-label">${escapeHtml(t('importPreview'))}</div>
        <p>${escapeHtml(renderKbPreviewSummary(preview))}</p>
      </div>
      <div class="kb-preview-actions">
        <button class="secondary-button" type="button" data-cancel-kb-preview>${escapeHtml(t('cancel'))}</button>
        <button class="primary-button" type="button" data-confirm-kb-import ${importableCount ? '' : 'disabled'}>
          ${escapeHtml(t('import', { count: importableCount }))}
        </button>
      </div>
    </div>
    ${
      documents.length
        ? `<div class="kb-preview-list">${documents.map(renderKbPreviewDocument).join('')}</div>`
        : `<p class="empty-report">${escapeHtml(t('noDocumentsPreviewed'))}</p>`
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
    return t('filesChecked', { count: files, importable, blockedOrFailed: blocked + failures });
  }

  return t('urlsChecked', { count: discovered, importable, blockedOrFailed: blocked + failures });
}

function renderKbPreviewDocument(document) {
  const sourceLabel = document.filename || document.sourceUri;

  return `
    <article class="kb-preview-item kb-preview-${escapeHtml(document.status)}">
      <div class="kb-preview-item-header">
        <span class="kb-quality-badge">${escapeHtml(qualityStatusLabel(document.status))}</span>
        <span>${escapeHtml(productLabel(document.productType))}</span>
      </div>
      <h3>${escapeHtml(document.title)}</h3>
      <p class="kb-preview-source" title="${escapeHtml(sourceLabel)}">${escapeHtml(sourceLabel)}</p>
      <div class="kb-preview-meta">
        <span>${escapeHtml(t('chars', { count: formatInteger(document.charCount) }))}</span>
        <span>${escapeHtml(t('chunks', { count: document.chunkCount }))}</span>
      </div>
      <p>${escapeHtml(document.excerpt || t('noReadableExcerpt'))}</p>
      <ul>
        ${(document.qualityMessages ?? []).map((message) => `<li>${escapeHtml(message)}</li>`).join('')}
      </ul>
    </article>
  `;
}

function renderKbPreviewFailure(failure) {
  const target = failure.url ?? failure.filename ?? t('unknownSource');
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
        reject(new Error(t('serverInvalidResponse')));
        return;
      }

      if (request.status >= 200 && request.status < 300) {
        resolve(payload);
        return;
      }

      reject(new Error(payload.error?.message ?? t('uploadFailed')));
    });

    request.addEventListener('error', () => reject(new Error(t('networkUploadError'))));
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
      throw new Error(bundlePayload.error?.message ?? t('unableToLoadUploads'));
    }

    if (!jobResponse.ok) {
      throw new Error(jobPayload.error?.message ?? t('unableToLoadAnalysisJobs'));
    }

    const analysisJobs = jobPayload.analysisJobs ?? [];
    latestBundles = bundlePayload.bundles ?? [];
    latestAnalysisJobs = analysisJobs;
    renderBundles(latestBundles, latestJobByBundleId(analysisJobs));
    schedulePolling(analysisJobs);
  } catch (error) {
    bundleRows.innerHTML = `<tr><td colspan="8" class="empty-cell">${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderBundles(bundles, analysisJobsByBundleId) {
  if (!bundles.length) {
    bundleRows.innerHTML = `<tr><td colspan="8" class="empty-cell">${escapeHtml(t('noUploadsYet'))}</td></tr>`;
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
          <td><span class="status-badge">${escapeHtml(statusLabel(bundle.uploadStatus))}</span></td>
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
              ${escapeHtml(t('view'))}
            </button>
          </td>
          <td>
            <button
              class="delete-button"
              type="button"
              data-delete-bundle-id="${escapeHtml(bundle.id)}"
              data-filename="${escapeHtml(bundle.originalFilename)}"
              ${job?.status === 'running' ? `disabled title="${escapeHtml(t('statusRunningTitle'))}"` : ''}
            >
              ${escapeHtml(t('delete'))}
            </button>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderKbStatus(kb = {}) {
  latestKbStatus = kb;
  const documentCount = kb.documentCount ?? 0;
  const chunkCount = kb.chunkCount ?? 0;
  kbSources = kb.sources ?? [];
  renderKbSources(kbSources);

  if (!documentCount) {
    kbStats.innerHTML = `
      <div class="kb-stat">
        <strong>0</strong>
        <span>${escapeHtml(t('documents'))}</span>
      </div>
      <p class="empty-report">${escapeHtml(t('noKbImported'))}</p>
    `;
    return;
  }

  kbStats.innerHTML = `
    <div class="kb-stat kb-stat-count">
      <strong>${documentCount}</strong>
      <span>${escapeHtml(t('documents'))}</span>
    </div>
    <div class="kb-stat kb-stat-count">
      <strong>${chunkCount}</strong>
      <span>${escapeHtml(t('chunksLabel'))}</span>
    </div>
    <div class="kb-stat kb-stat-provider">
      <strong>${escapeHtml(kb.embedding?.provider ?? 'unknown')}</strong>
      <span>${escapeHtml(t('dims', { count: String(kb.embedding?.dimensions ?? '') }))}</span>
    </div>
    <div class="kb-updated">${escapeHtml(t('updatedAt', { date: formatDate(kb.updatedAt) }))}</div>
  `;
}

function renderKbSources(sources = []) {
  const productFilter = kbSourceFilter.value;
  const filteredSources = productFilter ? sources.filter((source) => source.productType === productFilter) : sources;

  if (!filteredSources.length) {
    kbSourceList.innerHTML = `<p class="empty-report">${
      escapeHtml(sources.length ? t('noKbSourcesMatch') : t('noKbSourcesImported'))
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
          <span>${escapeHtml(t('chunks', { count: source.chunkCount ?? 0 }))}</span>
          <span>${escapeHtml(t('chars', { count: formatInteger(source.charCount) }))}</span>
        </div>
      </div>
      <button
        class="delete-button kb-source-delete"
        type="button"
        data-delete-kb-source-id="${escapeHtml(source.id)}"
        data-title="${escapeHtml(source.title)}"
      >
        ${escapeHtml(t('delete'))}
      </button>
    </article>
  `;
}

async function deleteKbSource(sourceId, title, button) {
  if (button.dataset.confirm !== 'true') {
    button.dataset.confirm = 'true';
    button.textContent = t('confirm');
    setKbMessage(t('confirmDeletion', { title }), 'warning');
    setTimeout(() => {
      if (button.dataset.confirm === 'true') {
        button.dataset.confirm = 'false';
        button.textContent = t('delete');
      }
    }, 3500);
    return;
  }

  button.disabled = true;
  setKbMessage(t('deletingSource', { title }));

  try {
    const response = await fetch(`/api/kb/sources/${encodeURIComponent(sourceId)}`, {
      method: 'DELETE',
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? t('kbSourceDeleteFailed'));
    }

    renderKbStatus(payload.kb);
    setKbMessage(t('deletedSource', { title }), 'success');

    if (reportContent.dataset.jobId) {
      await loadReport(reportContent.dataset.jobId);
    }
  } catch (error) {
    setKbMessage(error.message, 'error');
    button.disabled = false;
    button.dataset.confirm = 'false';
    button.textContent = t('delete');
  }
}

function renderAnalysisStatus(job) {
  if (!job) {
    return `<span class="status-badge analysis-not-started">${escapeHtml(t('notStarted'))}</span>`;
  }

  const label = `${statusLabel(job.status)}${job.stage && job.stage !== job.status ? ` · ${statusLabel(job.stage)}` : ''}`;
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

  reportContent.innerHTML = `<p class="empty-report">${escapeHtml(t('loadingReport'))}</p>`;
  reportPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const response = await fetch(`/api/analysis-jobs/${jobId}/report`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? t('unableToLoadReport'));
    }

    renderReport(payload.report);
  } catch (error) {
    reportContent.innerHTML = `<p class="empty-report error-text">${escapeHtml(error.message)}</p>`;
  }
}

async function deleteBundle(bundleId, filename) {
  setDeleteModalBusy(true);
  setDeleteModalMessage('');
  setFormMessage(t('deletingBundle', { filename }));

  try {
    const response = await fetch(`/api/bundles/${bundleId}`, {
      method: 'DELETE',
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? t('deleteFailed'));
    }

    setFormMessage(t('deletedBundle', { filename }), 'success');
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
  confirmDeleteButton.textContent = isBusy ? t('deleting') : t('delete');
}

function setDeleteModalMessage(message, state) {
  deleteModalMessage.textContent = message;
  deleteModalMessage.classList.remove('error');

  if (state) {
    deleteModalMessage.classList.add(state);
  }
}

function clearReport() {
  currentReport = null;
  delete reportContent.dataset.bundleId;
  delete reportContent.dataset.jobId;
  reportContent.innerHTML = `<p class="empty-report">${escapeHtml(t('reportsWillAppear'))}</p>`;
}

function renderReport(report) {
  currentReport = report;
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
        <span class="metric-label">${escapeHtml(t('groups'))}</span>
      </div>
      <div class="metric">
        <span class="metric-value">${findingSummary.total}</span>
        <span class="metric-label">${escapeHtml(t('findings'))}</span>
      </div>
      <div class="metric">
        <span class="metric-value">${summary.fileCount}</span>
        <span class="metric-label">${escapeHtml(t('files'))}</span>
      </div>
      <div class="metric">
        <span class="metric-value">${summary.directoryCount}</span>
        <span class="metric-label">${escapeHtml(t('directories'))}</span>
      </div>
      <div class="metric">
        <span class="metric-value">${formatBytes(summary.totalBytes)}</span>
        <span class="metric-label">${escapeHtml(t('extractedSize'))}</span>
      </div>
      <div class="metric">
        <span class="metric-value">${summary.totalEntries}</span>
        <span class="metric-label">${escapeHtml(t('entries'))}</span>
      </div>
      ${renderKbMetric(report.kbSummary)}
    </div>

    ${renderFindingGroups(report.findingGroups ?? [], groupSummary)}
    ${renderFindings(report.findings ?? [], findingSummary, report.findingGroups?.length)}

    <div class="report-grid">
      <div>
        <h3>${escapeHtml(t('archive'))}</h3>
        <dl class="report-dl">
          <dt>${escapeHtml(t('filename'))}</dt>
          <dd>${escapeHtml(report.archive.filename)}</dd>
          <dt>${escapeHtml(t('type'))}</dt>
          <dd>${escapeHtml(report.archive.archiveType)}</dd>
          ${renderArchiveMetadata(report.inventory)}
          <dt>SHA-256</dt>
          <dd class="mono">${escapeHtml(report.archive.sha256)}</dd>
        </dl>
      </div>
      <div>
        <h3>${escapeHtml(t('longhornInventory'))}</h3>
        ${renderLonghornInventory(report.inventory?.longhorn)}
      </div>
      <div>
        <h3>${escapeHtml(t('largestFiles'))}</h3>
        ${renderFileList(report.largestFiles)}
      </div>
    </div>

    <div class="report-files">
      <h3>${escapeHtml(summary.truncatedFileIndex ? t('indexedFilesLimited', { limit: summary.reportFileLimit }) : t('indexedFiles'))}</h3>
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
          <p class="eyebrow">${escapeHtml(t('correlation'))}</p>
          <h3 id="findingGroupsTitle">${escapeHtml(t('groupedFindings'))}</h3>
        </div>
        <div class="finding-summary" aria-label="${escapeHtml(t('findingGroupSeveritySummary'))}">
          <span class="severity-dot critical"></span>${summary.critical}
          <span class="severity-dot warning"></span>${summary.warning}
          <span class="severity-dot info"></span>${summary.info}
        </div>
      </div>
      ${
        groups.length
          ? `<div class="finding-group-list">${groups.map(renderFindingGroup).join('')}</div>`
          : `<p class="empty-report">${escapeHtml(t('noFindingGroups'))}</p>`
      }
    </section>
  `;
}

function renderFindingGroup(group) {
  const displayGroup = localizeFindingGroup(group);

  return `
    <article class="finding-group-card finding-${escapeHtml(group.severity)}">
      <div class="finding-card-header">
        <span class="finding-severity">${escapeHtml(severityLabel(group.severity))}</span>
        <span class="finding-category">${escapeHtml(t('linkedFindings', { count: group.relatedFindingIds?.length ?? 0 }))}</span>
      </div>
      <h4>${escapeHtml(displayGroup.title)}</h4>
      <p>${escapeHtml(displayGroup.description)}</p>
      <div class="finding-impact">${escapeHtml(displayGroup.impact)}</div>
      ${renderGroupAffected(group.affected)}
      ${renderRecommendedChecks(displayGroup.recommendedChecks)}
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
      <span class="metric-label">${escapeHtml(t('kbDocs'))}</span>
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
              <small>${escapeHtml(evidenceLabel(label))}</small>
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
      <h5>${escapeHtml(t('recommendedChecks'))}</h5>
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
      <h5>${escapeHtml(t('relatedKb'))}</h5>
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
          <p class="eyebrow">${escapeHtml(t('diagnostics'))}</p>
          <h3 id="findingsTitle">${escapeHtml(hasGroups ? t('findingDetails') : t('findings'))}</h3>
        </div>
        <div class="finding-summary" aria-label="${escapeHtml(t('findingSeveritySummary'))}">
          <span class="severity-dot critical"></span>${summary.critical}
          <span class="severity-dot warning"></span>${summary.warning}
          <span class="severity-dot info"></span>${summary.info}
        </div>
      </div>
      ${
        findings.length
          ? `<div class="finding-list">${findings.map(renderFinding).join('')}</div>`
          : `<p class="empty-report">${escapeHtml(t('noFindings'))}</p>`
      }
    </section>
  `;
}

function renderFinding(finding) {
  const displayFinding = localizeFinding(finding);
  const countLabel = Number.isFinite(finding.count) && finding.count > 1 ? t('matches', { count: finding.count }) : '';

  return `
    <article class="finding-card finding-${escapeHtml(finding.severity)}">
      <div class="finding-card-header">
        <span class="finding-severity">${escapeHtml(severityLabel(finding.severity))}</span>
        <span class="finding-category">${escapeHtml(categoryLabel(finding.category))}</span>
      </div>
      <h4>${escapeHtml(displayFinding.title)}${escapeHtml(countLabel)}</h4>
      <p>${escapeHtml(displayFinding.description)}</p>
      ${renderFindingEvidence(finding.evidence, finding.evidenceRefs)}
      ${finding.path ? renderEvidencePathButton(finding.path) : ''}
    </article>
  `;
}

function renderFindingEvidence(evidence = [], evidenceRefs = []) {
  if (!evidence.length) {
    return '';
  }

  return `
    <ul class="finding-evidence">
      ${evidence
        .map((line, index) => {
          const ref = evidenceRefs[index];
          const displayLine = localizeEvidenceLine(line);

          if (!ref?.path) {
            return `<li class="finding-evidence-item">${escapeHtml(displayLine)}</li>`;
          }

          return `
            <li class="finding-evidence-item clickable">
              <button
                class="evidence-link"
                type="button"
                data-preview-path="${escapeHtml(ref.path)}"
                data-line-start="${escapeHtml(ref.lineStart ?? '')}"
                data-line-end="${escapeHtml(ref.lineEnd ?? ref.lineStart ?? '')}"
                data-match-text="${escapeHtml(ref.excerpt ?? line)}"
              >
                ${escapeHtml(displayLine)}
              </button>
            </li>
          `;
        })
        .join('')}
    </ul>
  `;
}

function renderEvidencePathButton(reportPath) {
  return `
    <button
      class="evidence-link finding-path mono"
      type="button"
      data-preview-path="${escapeHtml(reportPath)}"
    >
      ${escapeHtml(reportPath)}
    </button>
  `;
}

function renderArchiveMetadata(inventory = {}) {
  const metadata = inventory.metadata ?? {};
  const longhornVersion = inventory.longhorn?.version?.version;
  const rows = [
    ['Kubernetes', metadata.kubernetesversion],
    ['Longhorn', longhornVersion],
    [t('created'), metadata.bundlecreatedat],
    [t('issueDescription'), metadata.issuedescription],
  ].filter(([, value]) => value);

  return rows
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');
}

function renderLonghornInventory(inventory = {}) {
  const rows = [
    [t('volumes'), inventory.volumes?.total, inventory.volumes?.unhealthy ? t('unhealthy', { count: inventory.volumes.unhealthy }) : t('healthy')],
    [t('replicas'), inventory.replicas?.total, inventory.replicas?.notRunning ? t('notRunning', { count: inventory.replicas.notRunning }) : t('running')],
    [t('nodes'), inventory.nodes?.total, inventory.nodes?.problematic ? t('withIssues', { count: inventory.nodes.problematic }) : t('ready')],
    [t('pods'), inventory.pods?.total, inventory.pods?.withRestarts ? t('restarted', { count: inventory.pods.withRestarts }) : t('steady')],
    [t('events'), inventory.events?.total, inventory.events?.warnings ? t('warnings', { count: inventory.events.warnings }) : t('normal')],
    [t('logs'), inventory.logs?.scannedFiles, inventory.logs?.matchedLines ? t('logMatches', { count: inventory.logs.matchedLines }) : t('quiet')],
  ].filter(([, count]) => Number.isFinite(count));

  if (!rows.length) {
    return `<p class="empty-report">${escapeHtml(t('noLonghornInventory'))}</p>`;
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
    return `<p class="empty-report">${escapeHtml(t('noEntriesFound'))}</p>`;
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
    return `<p class="empty-report">${escapeHtml(t('noFilesFound'))}</p>`;
  }

  return `
    <ul class="compact-list">
      ${files
        .map(
          (file) =>
            `<li>
              <button
                class="evidence-link compact-file-link"
                type="button"
                title="${escapeHtml(file.path)}"
                data-preview-path="${escapeHtml(file.path)}"
              >
                ${escapeHtml(file.path)}
              </button>
              <strong>${formatBytes(file.size)}</strong>
            </li>`,
        )
        .join('')}
    </ul>
  `;
}

function renderFileIndex(files) {
  if (!files.length) {
    return `<p class="empty-report">${escapeHtml(t('noFilesFound'))}</p>`;
  }

  return files
    .map(
      (file) => `
        <div class="file-index-row">
          <button
            class="evidence-link file-index-link"
            type="button"
            title="${escapeHtml(file.path)}"
            data-preview-path="${escapeHtml(file.path)}"
          >
            ${escapeHtml(file.path)}
          </button>
          <strong>${formatBytes(file.size)}</strong>
        </div>
      `,
    )
    .join('');
}

async function openEvidencePreview({ path: reportPath, lineStart = null, lineEnd = null, matchText = '' }) {
  const jobId = reportContent.dataset.jobId;

  if (!jobId || !reportPath) {
    return;
  }

  currentEvidencePath = reportPath;
  evidenceDrawer.hidden = false;
  document.body.classList.add('modal-open');
  evidenceDrawerTitle.textContent = t('loadingFile');
  evidenceDrawerPath.textContent = reportPath;
  evidenceDrawerMeta.textContent = '';
  evidenceDrawerBody.innerHTML = `<p class="empty-report">${escapeHtml(t('loadingEvidence'))}</p>`;
  closeEvidenceButton.focus();

  const params = new URLSearchParams({ path: reportPath });

  if (lineStart) {
    params.set('lineStart', String(lineStart));
  }

  if (lineEnd) {
    params.set('lineEnd', String(lineEnd));
  }

  if (matchText) {
    params.set('matchText', matchText);
  }

  try {
    const response = await fetch(`/api/analysis-jobs/${encodeURIComponent(jobId)}/files?${params}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error?.message ?? t('unableToLoadEvidenceFile'));
    }

    renderEvidenceFile(payload.file);
  } catch (error) {
    evidenceDrawerTitle.textContent = t('filePreview');
    evidenceDrawerBody.innerHTML = `<p class="empty-report error-text">${escapeHtml(error.message)}</p>`;
  }
}

function renderEvidenceFile(file = {}) {
  currentEvidencePath = file.path ?? currentEvidencePath;
  evidenceDrawerTitle.textContent = file.previewable ? t('filePreview') : t('previewUnavailable');
  evidenceDrawerPath.textContent = currentEvidencePath;
  evidenceDrawerMeta.textContent = [
    formatBytes(file.size),
    file.lineStart ? t('linesRange', { start: file.lineStart, end: file.lineEnd }) : null,
    file.truncated ? t('partialPreview') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (!file.previewable) {
    evidenceDrawerBody.innerHTML = `<p class="empty-report">${escapeHtml(file.message ?? t('fileCannotPreview'))}</p>`;
    return;
  }

  evidenceDrawerBody.innerHTML = `
    <div class="evidence-code-wrap">
      ${renderEvidenceCode(file)}
    </div>
  `;
  scrollHighlightedEvidenceIntoView();
}

function renderEvidenceCode(file) {
  const lines = String(file.content ?? '').split(/\r?\n/);
  const firstLine = file.lineStart ?? 1;
  const requestedStart = file.requestedLineStart ?? null;
  const requestedEnd = file.requestedLineEnd ?? requestedStart;

  return lines
    .map((line, index) => {
      const lineNumber = firstLine + index;
      const highlighted =
        requestedStart && lineNumber >= requestedStart && lineNumber <= requestedEnd;

      return `
        <div class="evidence-code-line${highlighted ? ' highlighted' : ''}">
          <span class="evidence-line-number">${lineNumber}</span>
          <code>${escapeHtml(line || ' ')}</code>
        </div>
      `;
    })
    .join('');
}

function scrollHighlightedEvidenceIntoView() {
  requestAnimationFrame(() => {
    const highlightedLine = evidenceDrawerBody.querySelector('.evidence-code-line.highlighted');

    if (!highlightedLine) {
      return;
    }

    highlightedLine.scrollIntoView({
      block: 'center',
      inline: 'nearest',
    });
  });
}

function closeEvidenceDrawer() {
  evidenceDrawer.hidden = true;
  document.body.classList.remove('modal-open');
  currentEvidencePath = '';
}

async function copyEvidencePath() {
  if (!currentEvidencePath) {
    return;
  }

  try {
    await navigator.clipboard.writeText(currentEvidencePath);
    evidenceDrawerMeta.textContent = `${evidenceDrawerMeta.textContent || t('path')} · ${t('copied')}`;
  } catch {
    evidenceDrawerMeta.textContent = `${evidenceDrawerMeta.textContent || t('path')} · ${t('copyFailed')}`;
  }
}

function productLabel(productType) {
  if (productType === 'longhorn') {
    return 'Longhorn';
  }

  if (productType === 'harvester') {
    return 'Harvester';
  }

  return t('unknown');
}

function statusLabel(status) {
  return STATUS_LABELS[currentLanguage]?.[status] ?? STATUS_LABELS[DEFAULT_LANGUAGE][status] ?? status ?? '';
}

function severityLabel(severity) {
  return SEVERITY_LABELS[currentLanguage]?.[severity] ?? SEVERITY_LABELS[DEFAULT_LANGUAGE][severity] ?? severity ?? '';
}

function categoryLabel(category) {
  return CATEGORY_LABELS[currentLanguage]?.[category] ?? category ?? '';
}

function localizeFindingGroup(group) {
  return {
    ...group,
    ...(GROUP_TEXT[currentLanguage]?.[group.id] ?? {}),
  };
}

function localizeFinding(finding) {
  const exact = FINDING_TEXT[currentLanguage]?.[finding.id];

  if (exact) {
    return {
      ...finding,
      ...exact,
    };
  }

  if (currentLanguage !== 'zh-CN') {
    return finding;
  }

  return {
    ...finding,
    title: localizeFindingTitle(finding.title),
    description: localizeFindingDescription(finding.description),
  };
}

function localizeFindingTitle(title) {
  const text = String(title ?? '');
  const volumeState = text.match(/^Volume (.+) is (.+)$/);

  if (volumeState) {
    return `卷 ${volumeState[1]} 状态为 ${volumeState[2]}`;
  }

  const volumeCondition = text.match(/^Volume (.+) has (.+)$/);

  if (volumeCondition) {
    return `卷 ${volumeCondition[1]} 存在 ${volumeCondition[2]}`;
  }

  const replicaState = text.match(/^Replica (.+) is (.+)$/);

  if (replicaState) {
    return `副本 ${replicaState[1]} 状态为 ${replicaState[2]}`;
  }

  const replicaCondition = text.match(/^Replica (.+) has (.+)$/);

  if (replicaCondition) {
    return `副本 ${replicaCondition[1]} 存在 ${replicaCondition[2]}`;
  }

  const nodeCondition = text.match(/^Node (.+) has (.+) issue$/);

  if (nodeCondition) {
    return `节点 ${nodeCondition[1]} 存在 ${nodeCondition[2]} 问题`;
  }

  const podPhase = text.match(/^Pod (.+) is (.+)$/);

  if (podPhase) {
    return `Pod ${podPhase[1]} 状态为 ${podPhase[2]}`;
  }

  const alert = text.match(/^(.+) is firing$/);

  if (alert) {
    return `${alert[1]} 正在告警`;
  }

  return text;
}

function localizeFindingDescription(description) {
  const descriptions = {
    'Longhorn reports a volume robustness value other than healthy.':
      'Longhorn 报告该卷的 robustness 不是 healthy。',
    'A Longhorn volume condition that usually indicates pending work is active.':
      'Longhorn 卷上存在通常表示待处理工作的活跃条件。',
    'Longhorn reports a replica state other than running.':
      'Longhorn 报告该副本状态不是 running。',
    'A Longhorn replica problem condition is active.':
      'Longhorn 副本上存在活跃的问题条件。',
    'A Longhorn node readiness or prerequisite condition is not satisfied.':
      'Longhorn 节点 readiness 或前置条件未满足。',
    'A pod in longhorn-system is not currently running.':
      'longhorn-system 中的 Pod 当前没有处于运行状态。',
    'Alert is firing.': '告警正在触发。',
  };

  return descriptions[description] ?? description;
}

function localizeEvidenceLine(line) {
  if (currentLanguage !== 'zh-CN') {
    return line;
  }

  const text = String(line);
  const match = text.match(/^([^:]+):\s*(.*)$/);

  if (!match) {
    return text;
  }

  return `${evidenceLabel(match[1])}: ${match[2]}`;
}

function evidenceLabel(label) {
  return EVIDENCE_LABELS[currentLanguage]?.[label] ?? label;
}

function qualityStatusLabel(status) {
  if (status === 'ready') {
    return t('ready');
  }

  if (status === 'warning') {
    return t('statusWarning');
  }

  if (status === 'blocked') {
    return t('statusBlocked');
  }

  return status ?? '';
}

function setApiStatus(messageKey, state) {
  apiStatusKey = messageKey;
  apiStatusState = state;
  apiStatus.textContent = t(messageKey);
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
  return Number.isFinite(value) ? new Intl.NumberFormat(LOCALES[currentLanguage]).format(value) : '0';
}

function toOptionalNumber(value) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(LOCALES[currentLanguage], {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatKbScore(score) {
  if (!Number.isFinite(score)) {
    return t('match');
  }

  return t('percentMatch', { percent: Math.round(score * 100) });
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
