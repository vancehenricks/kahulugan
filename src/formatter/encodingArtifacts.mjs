// Common encoding corruption patterns found in PDFs

export const ENCODING_ARTIFACTS = [
  {
    pattern: /1aшphi1/g,
    description: 'Cyrillic mix corruption',
  },
  {
    pattern: /£A⩊phi£/g,
    description: 'Currency/math symbol corruption',
  },
  {
    pattern: /1awp\+\+i1/g,
    description: 'Plus sign corruption',
  },
  {
    // eslint-disable-next-line no-control-regex
    pattern: /[\x00-\x08\x0B\x0C\x0E-\x1F]/g,
    description: 'Control characters',
  },
  {
    pattern: /1-vvph-l. n-t/g,
    description: 'Hyphenation corruption',
  },
  {
    pattern: /\ufffd/g,
    description: 'Unicode replacement character',
  },
  {
    pattern: /шphi1/g,
    description: 'Partial Cyrillic mix corruption',
  },
  {
    pattern: /£A⩊phi/g,
    description: 'Partial currency/math symbol corruption',
  },
  {
    pattern: /lawphi1.net/g,
    description: 'Partial URL corruption',
  },
  {
    pattern: /1awphil.ñêt/g,
    description: 'Partial URL with plus sign corruption',
  },
  {
    pattern: /lawphil/g,
    description: 'Partial URL text corruption',
  },
  {
    pattern: /ℒαwρhi৷/g,
    description: 'Partial plus sign corruption',
  },
  {
    pattern: /1âwphi1/g,
    description: 'Partial plus sign corruption',
  }

];

export function removeEncodingArtifacts(text) {
  let cleaned = text;
  for (const artifact of ENCODING_ARTIFACTS) {
    cleaned = cleaned.replace(artifact.pattern, '');
  }
  return cleaned;
}
