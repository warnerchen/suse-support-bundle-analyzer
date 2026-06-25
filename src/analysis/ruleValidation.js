import { RULES_DIR } from '../config.js';
import { HARVESTER_RULE_DEFAULTS } from './harvesterAnalyzer.js';
import { LONGHORN_RULE_DEFAULTS } from './longhornAnalyzer.js';
import { validateRulesDirectory } from './ruleLoader.js';

export const PRODUCT_RULE_SPECS = [
  {
    id: 'longhorn',
    logDefaults: LONGHORN_RULE_DEFAULTS.logs,
    conditionDefaults: LONGHORN_RULE_DEFAULTS.conditions,
  },
  {
    id: 'harvester',
    logDefaults: HARVESTER_RULE_DEFAULTS.logs,
    conditionDefaults: HARVESTER_RULE_DEFAULTS.conditions,
  },
];

export async function validateRuntimeRules({ rulesDir = RULES_DIR } = {}) {
  return validateRulesDirectory(PRODUCT_RULE_SPECS, { rulesDir });
}
