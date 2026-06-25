import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LONGHORN_RULE_DEFAULTS } from '../src/analysis/longhornAnalyzer.js';
import {
  clearRuleCache,
  loadProductLogConfig,
  validateProductRules,
} from '../src/analysis/ruleLoader.js';

test('hot reloads rules when the YAML file changes', async () => {
  const rulesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rules-hot-reload-'));
  const rulesPath = path.join(rulesDir, 'longhorn.yaml');

  try {
    await fs.writeFile(
      rulesPath,
      [
        'logs:',
        '  rules:',
        '    - id: first-rule',
        '      severity: warning',
        '      category: Longhorn Logs',
        '      title: First rule',
        '      description: First rule description.',
        '      regex: first-sentinel',
      ].join('\n'),
      'utf8',
    );

    clearRuleCache();
    const first = await loadProductLogConfig('longhorn', LONGHORN_RULE_DEFAULTS.logs, { rulesDir });
    assert.equal(first.patterns[0].id, 'first-rule');

    await fs.writeFile(
      rulesPath,
      [
        'logs:',
        '  rules:',
        '    - id: second-rule',
        '      severity: warning',
        '      category: Longhorn Logs',
        '      title: Second rule',
        '      description: Second rule description after reload.',
        '      regex: second-sentinel',
      ].join('\n'),
      'utf8',
    );
    await fs.utimes(rulesPath, new Date(), new Date(Date.now() + 1000));

    const second = await loadProductLogConfig('longhorn', LONGHORN_RULE_DEFAULTS.logs, { rulesDir });
    assert.equal(second.patterns[0].id, 'second-rule');
  } finally {
    clearRuleCache();
    await fs.rm(rulesDir, { recursive: true, force: true });
  }
});

test('validates rules and reports invalid log regex and condition predicates', async () => {
  const rulesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rules-validation-'));

  try {
    await fs.writeFile(
      path.join(rulesDir, 'longhorn.yaml'),
      [
        'logs:',
        '  rules:',
        '    - id: invalid-regex',
        '      severity: warning',
        '      category: Longhorn Logs',
        '      title: Invalid regex',
        '      description: This regex should fail validation.',
        '      regex: "["',
        'conditions:',
        '  rules:',
        '    - id: invalid-condition',
        '      resource: longhornVolumeCondition',
        '      severity: warning',
        '      category: Longhorn Volume',
        '      title: Invalid condition',
        '      description: This predicate should fail validation.',
        '      when: condition.status ~~ True',
      ].join('\n'),
      'utf8',
    );

    clearRuleCache();
    const validation = await validateProductRules('longhorn', {
      logDefaults: LONGHORN_RULE_DEFAULTS.logs,
      conditionDefaults: LONGHORN_RULE_DEFAULTS.conditions,
      rulesDir,
    });

    assert.equal(validation.valid, false);
    assert.equal(validation.sections.logs, true);
    assert.equal(validation.sections.conditions, true);
    assert.ok(validation.errors.some((error) => error.includes('not a valid regular expression')));
    assert.ok(validation.errors.some((error) => error.includes('unsupported predicate syntax')));
  } finally {
    clearRuleCache();
    await fs.rm(rulesDir, { recursive: true, force: true });
  }
});

test('reports missing rules files as valid with default-rule warnings', async () => {
  const rulesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rules-missing-'));

  try {
    clearRuleCache();
    const validation = await validateProductRules('longhorn', {
      logDefaults: LONGHORN_RULE_DEFAULTS.logs,
      conditionDefaults: LONGHORN_RULE_DEFAULTS.conditions,
      rulesDir,
    });

    assert.equal(validation.valid, true);
    assert.equal(validation.exists, false);
    assert.ok(validation.warnings.some((warning) => warning.includes('defaults')));
  } finally {
    clearRuleCache();
    await fs.rm(rulesDir, { recursive: true, force: true });
  }
});
