/**
 * Checks whether the automation has real production credentials.
 * This never prints secret values.
 */

import "./lib/load-env.mjs";
import { getReadinessReport } from "./lib/env-validation.mjs";

const report = getReadinessReport(process.env);

console.log("=== Production readiness ===");
console.log(`Ready: ${report.ready ? "yes" : "no"}`);
if (report.blockers.length) {
  console.log("Blockers:");
  for (const blocker of report.blockers) console.log(`  - ${blocker}`);
}
if (report.warnings.length) {
  console.log("Warnings:");
  for (const warning of report.warnings) console.log(`  - ${warning}`);
}

if (!report.ready) process.exit(1);
