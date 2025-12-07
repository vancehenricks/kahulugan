import { log, warn } from '../logs.mjs';

import { repairTextEncoding } from './characterRecovery.mjs';
import { removeEncodingArtifacts } from './encodingArtifacts.mjs';

function verifyContentIntegrity(original, formatted) {
  const normalize = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();

  const originalNorm = normalize(original);
  const formattedNorm = normalize(formatted);
  const preservation =
    originalNorm.length > 0 ? ((formattedNorm.length / originalNorm.length) * 100).toFixed(2) : 100;

  return {
    isValid: preservation >= 95,
    preservation: preservation + '%',
    originalLength: originalNorm.length,
    formattedLength: formattedNorm.length,
  };
}

export async function formatDocument(text) {
  const { text: repaired, recovered } = repairTextEncoding(text);

  if (recovered.length > 0) {
    log(`Recovered ${recovered.length} characters`);
  }

  const formatted = removeEncodingArtifacts(repaired);
    
  try {
    const integrity = verifyContentIntegrity(text, formatted);
    log(`Content preservation: ${integrity.preservation}`);

    return formatted;
  } catch (err) {
    warn('Formatting error:', err.message);
    return text;
  }
}
