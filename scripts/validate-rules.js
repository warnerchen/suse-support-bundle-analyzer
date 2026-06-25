#!/usr/bin/env node

import path from 'node:path';
import { RULES_DIR } from '../src/config.js';
import { validateRuntimeRules } from '../src/analysis/ruleValidation.js';

const rulesDir = process.argv[2] ? path.resolve(process.argv[2]) : RULES_DIR;
const validation = await validateRuntimeRules({ rulesDir });

console.log(`Rule directory: ${validation.rulesDir}`);

for (const product of validation.products) {
  const marker = product.valid ? 'OK' : 'ERROR';
  const sections = [
    product.sections.logs ? 'logs' : null,
    product.sections.conditions ? 'conditions' : null,
  ]
    .filter(Boolean)
    .join(', ') || 'defaults';

  console.log(`${marker} ${product.productId} (${sections})`);
  console.log(`  ${product.path}`);

  for (const warning of product.warnings) {
    console.log(`  warning: ${warning}`);
  }

  for (const error of product.errors) {
    console.log(`  error: ${error}`);
  }
}

if (!validation.valid) {
  process.exitCode = 1;
}
