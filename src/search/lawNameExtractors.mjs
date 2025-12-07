// Main orchestrator - simplified

import * as amExtractors from './extractors/amExtractors.mjs';
import * as fallbackExtractors from './extractors/fallbackExtractors.mjs';
import * as grExtractors from './extractors/grExtractors.mjs';
import * as regulatoryExtractors from './extractors/regulatoryExtractors.mjs';

export function extractLawName(text) {
  return (
    grExtractors.extractGRLawName(text) ||
    amExtractors.extractAMLawName(text) ||
    regulatoryExtractors.extractResolutionLawName(text) ||
    regulatoryExtractors.extractStatueLawName(text) ||
    regulatoryExtractors.extractCommissionResolutionLawName(text) ||
    fallbackExtractors.extractFallbackLawName(text)
  );
}
