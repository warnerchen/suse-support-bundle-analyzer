import fs from 'node:fs/promises';
import path from 'node:path';
import { RULES_DIR } from '../config.js';

const VALID_SEVERITIES = new Set(['critical', 'warning', 'info']);
const DEFAULT_REGEX_FLAGS = 'i';
const DEFAULT_PRIORITY = 1000;
const rulesDocumentCache = new Map();

export async function loadProductLogConfig(productId, defaults, options = {}) {
  const document = await loadProductRulesDocument(productId, options);

  if (!document.exists) {
    return normalizeLogConfig(defaults, `${productId} defaults`);
  }

  const logs = document.parsed.logs;

  if (!logs) {
    return normalizeLogConfig(defaults, `${productId} defaults`);
  }

  if (typeof logs !== 'object' || Array.isArray(logs)) {
    throw new Error(`Rules file ${document.path} logs section must be an object.`);
  }

  return normalizeLogConfig(
    {
      maxFiles: logs.maxFiles ?? defaults.maxFiles,
      include: logs.include ?? defaults.include,
      priorities: logs.priorities ?? defaults.priorities,
      rules: logs.rules ?? defaults.rules,
    },
    document.path,
  );
}

export async function loadProductConditionRules(productId, defaults, options = {}) {
  const document = await loadProductRulesDocument(productId, options);

  if (!document.exists) {
    return normalizeConditionRules(defaults, `${productId} defaults`);
  }

  const conditions = document.parsed.conditions;

  if (!conditions) {
    return normalizeConditionRules(defaults, `${productId} defaults`);
  }

  if (typeof conditions !== 'object' || Array.isArray(conditions)) {
    throw new Error(`Rules file ${document.path} conditions section must be an object.`);
  }

  return normalizeConditionRules(conditions.rules ?? defaults, `${document.path} conditions.rules`);
}

export async function validateProductRules(productId, { logDefaults, conditionDefaults, rulesDir } = {}) {
  const result = {
    productId,
    path: resolveProductRulesPath(productId, rulesDir),
    exists: false,
    valid: true,
    sections: {
      logs: false,
      conditions: false,
    },
    errors: [],
    warnings: [],
  };

  let document;

  try {
    document = await loadProductRulesDocument(productId, { rulesDir });
  } catch (error) {
    return {
      ...result,
      valid: false,
      errors: [error.message],
    };
  }

  result.exists = document.exists;

  if (!document.exists) {
    result.warnings.push('Rules file is missing; analyzer defaults will be used.');
    return result;
  }

  const knownSections = new Set(['logs', 'conditions']);
  const unknownSections = Object.keys(document.parsed).filter((section) => !knownSections.has(section));

  for (const section of unknownSections) {
    result.warnings.push(`Unknown top-level section "${section}" will be ignored.`);
  }

  if (logDefaults) {
    const logs = document.parsed.logs;

    if (logs) {
      result.sections.logs = true;

      if (typeof logs !== 'object' || Array.isArray(logs)) {
        result.errors.push(`Rules file ${document.path} logs section must be an object.`);
      } else {
        try {
          normalizeLogConfig(
            {
              maxFiles: logs.maxFiles ?? logDefaults.maxFiles,
              include: logs.include ?? logDefaults.include,
              priorities: logs.priorities ?? logDefaults.priorities,
              rules: logs.rules ?? logDefaults.rules,
            },
            document.path,
          );
        } catch (error) {
          result.errors.push(error.message);
        }
      }
    } else {
      result.warnings.push('No logs section found; log analyzer defaults will be used.');
    }
  }

  if (conditionDefaults) {
    const conditions = document.parsed.conditions;

    if (conditions) {
      result.sections.conditions = true;

      if (typeof conditions !== 'object' || Array.isArray(conditions)) {
        result.errors.push(`Rules file ${document.path} conditions section must be an object.`);
      } else {
        try {
          normalizeConditionRules(conditions.rules ?? conditionDefaults, `${document.path} conditions.rules`);
        } catch (error) {
          result.errors.push(error.message);
        }
      }
    } else {
      result.warnings.push('No conditions section found; condition analyzer defaults will be used.');
    }
  }

  result.valid = result.errors.length === 0;
  return result;
}

export async function validateRulesDirectory(products, options = {}) {
  const results = [];

  for (const product of products) {
    results.push(
      await validateProductRules(product.id, {
        logDefaults: product.logDefaults,
        conditionDefaults: product.conditionDefaults,
        rulesDir: options.rulesDir,
      }),
    );
  }

  return {
    rulesDir: path.resolve(options.rulesDir ?? RULES_DIR),
    valid: results.every((result) => result.valid),
    products: results,
  };
}

export function clearRuleCache() {
  rulesDocumentCache.clear();
}

export function isIncludedLogPath(reportPath, includePatterns) {
  const normalizedPath = normalizeRulePath(reportPath);
  return includePatterns.some((pattern) => normalizedPath.includes(normalizeRulePath(pattern)));
}

export function priorityForLogPath(reportPath, priorities) {
  const normalizedPath = normalizeRulePath(reportPath);
  let priority = DEFAULT_PRIORITY;

  for (const rule of priorities) {
    if (normalizedPath.includes(normalizeRulePath(rule.pattern))) {
      priority = Math.min(priority, rule.priority);
    }
  }

  return priority;
}

export function findConditionRule(rules, resource, facts) {
  return rules.find((rule) => rule.resource === resource && rule.predicates.every((predicate) => predicate(facts))) ?? null;
}

export function buildConditionFinding(rule, facts) {
  return {
    id: renderTemplate(rule.id, facts),
    severity: resolveConditionSeverity(rule, facts),
    category: rule.category,
    title: renderTemplate(rule.title, facts),
    description: renderTemplate(rule.description, facts),
    evidence: renderConditionEvidence(rule.evidence, facts),
  };
}

async function loadProductRulesDocument(productId, options = {}) {
  const rulesPath = resolveProductRulesPath(productId, options.rulesDir);
  let stats;

  try {
    stats = await fs.stat(rulesPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      rulesDocumentCache.delete(rulesPath);
      return {
        exists: false,
        path: rulesPath,
        parsed: {},
      };
    }

    throw error;
  }

  const signature = `${stats.mtimeMs}:${stats.size}`;
  const cached = rulesDocumentCache.get(rulesPath);

  if (cached?.signature === signature) {
    return cached.document;
  }

  const content = await fs.readFile(rulesPath, 'utf8');
  const document = {
    exists: true,
    path: rulesPath,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    parsed: parseRulesYaml(content, rulesPath),
  };

  rulesDocumentCache.set(rulesPath, {
    signature,
    document,
  });

  return document;
}

function resolveProductRulesPath(productId, rulesDir) {
  return path.join(path.resolve(rulesDir ?? RULES_DIR), `${productId}.yaml`);
}

function normalizeLogConfig(config, source) {
  return {
    maxFiles: positiveInteger(config.maxFiles, `${source} logs.maxFiles`),
    include: stringArray(config.include, `${source} logs.include`),
    priorities: priorityRules(config.priorities ?? [], `${source} logs.priorities`),
    patterns: logRules(config.rules, `${source} logs.rules`),
  };
}

function normalizeConditionRules(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty list.`);
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${label}[${index}] must be an object.`);
    }

    const rule = {
      id: requiredString(item.id, `${label}[${index}].id`),
      resource: requiredString(item.resource, `${label}[${index}].resource`),
      severity: requiredString(item.severity, `${label}[${index}].severity`),
      category: requiredString(item.category, `${label}[${index}].category`),
      title: requiredString(item.title, `${label}[${index}].title`),
      description: requiredString(item.description, `${label}[${index}].description`),
      when: requiredString(item.when, `${label}[${index}].when`),
      evidence: parseEvidenceSpec(item.evidence ?? '', `${label}[${index}].evidence`),
      severityOverrides: parseSeverityOverrides(
        item.severityOverrides ?? '',
        `${label}[${index}].severityOverrides`,
      ),
    };

    if (!VALID_SEVERITIES.has(rule.severity)) {
      throw new Error(`${label}[${index}].severity must be critical, warning, or info.`);
    }

    return {
      ...rule,
      predicates: parseConditionPredicates(rule.when, `${label}[${index}].when`),
    };
  });
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be a non-empty string list.`);
  }

  return value.map((item) => item.trim());
}

function priorityRules(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a list.`);
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${label}[${index}] must be an object.`);
    }

    if (typeof item.pattern !== 'string' || !item.pattern.trim()) {
      throw new Error(`${label}[${index}].pattern must be a non-empty string.`);
    }

    return {
      pattern: item.pattern.trim(),
      priority: nonNegativeInteger(item.priority, `${label}[${index}].priority`),
    };
  });
}

function parseConditionPredicates(value, label) {
  const expressions = String(value)
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!expressions.length) {
    throw new Error(`${label} must contain at least one predicate.`);
  }

  return expressions.map((expression, index) => parseConditionPredicate(expression, `${label}[${index}]`));
}

function parseConditionPredicate(expression, label) {
  const existsMatch = expression.match(/^([A-Za-z0-9_.-]+)\s+(exists|notEmpty)$/);

  if (existsMatch) {
    const [, field, operator] = existsMatch;
    return (facts) => {
      const value = facts[field];
      return operator === 'exists'
        ? value !== undefined && value !== null
        : value !== undefined && value !== null && String(value).trim() !== '';
    };
  }

  const operatorMatch = expression.match(/^([A-Za-z0-9_.-]+)\s*(==|!=|in|notIn|matches)\s*(.+)$/);

  if (!operatorMatch) {
    throw new Error(`${label} has unsupported predicate syntax: ${expression}`);
  }

  const [, field, operator, rawExpected] = operatorMatch;
  const expected = stripQuotes(rawExpected.trim());

  if (operator === 'in' || operator === 'notIn') {
    const values = expected
      .split('|')
      .map((item) => stripQuotes(item.trim()))
      .filter(Boolean);

    if (!values.length) {
      throw new Error(`${label} must provide at least one value for ${operator}.`);
    }

    return (facts) => {
      const hasValue = values.includes(normalizeComparisonValue(facts[field]));
      return operator === 'in' ? hasValue : !hasValue;
    };
  }

  if (operator === 'matches') {
    const regex = compileRegex(expected, DEFAULT_REGEX_FLAGS, label);
    return (facts) => regex.test(normalizeComparisonValue(facts[field]));
  }

  return (facts) => {
    const actual = normalizeComparisonValue(facts[field]);
    return operator === '==' ? actual === expected : actual !== expected;
  };
}

function parseEvidenceSpec(value, label) {
  if (!value) {
    return [];
  }

  if (typeof value !== 'string') {
    throw new Error(`${label} must be a comma-separated string.`);
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf('=');

      if (separator === -1) {
        throw new Error(`${label} item must be Label=field: ${item}`);
      }

      return {
        label: item.slice(0, separator).trim(),
        field: item.slice(separator + 1).trim(),
      };
    });
}

function parseSeverityOverrides(value, label) {
  if (!value) {
    return [];
  }

  if (typeof value !== 'string') {
    throw new Error(`${label} must be a comma-separated string.`);
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^([A-Za-z0-9_.-]+)=([^:]+):(critical|warning|info)$/);

      if (!match) {
        throw new Error(`${label} item must use field=value:severity syntax: ${item}`);
      }

      return {
        field: match[1],
        value: stripQuotes(match[2].trim()),
        severity: match[3],
      };
    });
}

function nonNegativeInteger(value, label) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return parsed;
}

function logRules(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty list.`);
  }

  const seenIds = new Set();

  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${label}[${index}] must be an object.`);
    }

    const rule = {
      id: requiredString(item.id, `${label}[${index}].id`),
      severity: requiredString(item.severity, `${label}[${index}].severity`),
      category: requiredString(item.category, `${label}[${index}].category`),
      title: requiredString(item.title, `${label}[${index}].title`),
      description: requiredString(item.description, `${label}[${index}].description`),
      regex: requiredString(item.regex, `${label}[${index}].regex`),
      flags: normalizeRegexFlags(item.flags ?? DEFAULT_REGEX_FLAGS, `${label}[${index}].flags`),
    };

    if (seenIds.has(rule.id)) {
      throw new Error(`${label}[${index}].id duplicates ${rule.id}.`);
    }

    if (!VALID_SEVERITIES.has(rule.severity)) {
      throw new Error(`${label}[${index}].severity must be critical, warning, or info.`);
    }

    seenIds.add(rule.id);

    return {
      id: rule.id,
      severity: rule.severity,
      category: rule.category,
      title: rule.title,
      description: rule.description,
      test: compileRegex(rule.regex, rule.flags, `${label}[${index}].regex`),
    };
  });
}

function resolveConditionSeverity(rule, facts) {
  for (const override of rule.severityOverrides) {
    if (normalizeComparisonValue(facts[override.field]) === override.value) {
      return override.severity;
    }
  }

  return rule.severity;
}

function renderConditionEvidence(spec, facts) {
  return spec
    .map((entry) => {
      const value = facts[entry.field];

      if (value === undefined || value === null || String(value).trim() === '') {
        return null;
      }

      return `${entry.label}: ${value}`;
    })
    .filter(Boolean);
}

function renderTemplate(template, facts) {
  return template.replaceAll(/\{([A-Za-z0-9_.-]+)\}/g, (_, field) => {
    const value = facts[field];
    return value === undefined || value === null ? '' : String(value);
  });
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function normalizeComparisonValue(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function normalizeRegexFlags(value, label) {
  const flags = String(value ?? '').trim();

  if (!/^[imsu]*$/.test(flags)) {
    throw new Error(`${label} can only contain i, m, s, or u.`);
  }

  return [...new Set(flags || DEFAULT_REGEX_FLAGS)].join('');
}

function compileRegex(pattern, flags, label) {
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(`${label} is not a valid regular expression: ${error.message}`);
  }
}

function parseRulesYaml(content, source) {
  const root = {};
  let section = null;
  let listKey = null;
  let currentItem = null;

  for (const rawLine of content.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) {
      continue;
    }

    const indent = rawLine.match(/^ */)[0].length;
    const trimmed = rawLine.trim();

    if (indent === 0) {
      const { key, value } = splitYamlPair(trimmed, source);
      root[key] = value === '' ? {} : parseYamlScalar(value);
      section = value === '' ? key : null;
      listKey = null;
      currentItem = null;
      continue;
    }

    if (!section || !root[section] || typeof root[section] !== 'object') {
      throw new Error(`Unexpected indentation in ${source}: ${rawLine}`);
    }

    if (indent === 2) {
      const { key, value } = splitYamlPair(trimmed, source);
      root[section][key] = value === '' ? [] : parseYamlScalar(value);
      listKey = value === '' ? key : null;
      currentItem = null;
      continue;
    }

    if (indent === 4 && listKey) {
      if (trimmed.startsWith('- ')) {
        const itemText = trimmed.slice(2).trim();

        if (!itemText) {
          currentItem = {};
          root[section][listKey].push(currentItem);
          continue;
        }

        if (itemText.includes(':')) {
          currentItem = {};
          root[section][listKey].push(currentItem);
          assignYamlPair(currentItem, itemText, source);
          continue;
        }

        root[section][listKey].push(parseYamlScalar(itemText));
        currentItem = null;
        continue;
      }

      if (!currentItem) {
        throw new Error(`Expected list item in ${source}: ${rawLine}`);
      }

      assignYamlPair(currentItem, trimmed, source);
      continue;
    }

    if (indent === 6 && currentItem) {
      assignYamlPair(currentItem, trimmed, source);
      continue;
    }

    throw new Error(`Unsupported YAML structure in ${source}: ${rawLine}`);
  }

  return root;
}

function assignYamlPair(target, line, source) {
  const { key, value } = splitYamlPair(line, source);
  target[key] = parseYamlScalar(value);
}

function splitYamlPair(line, source) {
  const separator = line.indexOf(':');

  if (separator === -1) {
    throw new Error(`Expected key/value pair in ${source}: ${line}`);
  }

  return {
    key: line.slice(0, separator).trim(),
    value: line.slice(separator + 1).trim(),
  };
}

function parseYamlScalar(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  if (/^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return value;
}

function normalizeRulePath(value) {
  return String(value ?? '').replaceAll('\\', '/');
}
