import fs from 'fs/promises';
import path from 'path';

import pLimit from 'p-limit';

import { pgClient } from './db.mjs';
import { getQueryEmbedding }  from './llm.mjs';
import { log } from './logs.mjs';
import { downsampleEmbedding } from './utils/downsample.mjs';

const CORPUS_DIR = process.env.RAG_CORPUS_PATH;

// deterministic downsample function (block-averaging)
// you can reuse the import script's algorithm to keep consistent dims
/* downsampleEmbedding now imported from ./utils/downsample.mjs */

export async function searchNearest(query, k = 5, opts = {}) {

  if (!query || query === '') return [];

  let params = null; // will be set later if/when we need vector search
  let whereClause = '';
  let searchByTitleRaw = null;
  if (opts && opts.searchByTitle === true) {
    searchByTitleRaw = String(query).trim();
  }

  // Helper: try to extract a (type, evidence) pair from queries like
  // "G.R. No. 100264-81" or "RA 9262". Returns {type, evidence} or null.
  function extractTypeEvidence(q) {
    if (!q || typeof q !== 'string') return null;
    const s = q.trim();
    // match: optional letters/dots/spaces then optional 'No.'/Number/# then id
    const m = s.match(/^\s*([A-Za-z.\s]{1,30}?)\s*(?:No\.?|Number|#)?\s*([-0-9A-Za-z/]+)\s*$/i);
    if (!m) return null;
    const t = String(m[1] || '').trim();
    const ev = String(m[2] || '').trim();
    if (!t || !ev) return null;
    return { type: t, evidence: ev };
  }

  // Helper: generate expanded variants for common abbreviated titles
  function generateTitleVariants(q) {
    if (!q || typeof q !== 'string') return [q];
    const s = q.trim();
    const variants = new Set([s]);

    // common patterns like "RA 1061", "R.A. 1061", "RA1061"
    const abbrMap = {
      '\\bR\\.A\\.|\\bRA\\b': 'Republic Act',
      '\\bG\\.R\\.|\\bGR\\b': 'G.R.',
      '\\bC\\.A\\.|\\bCA\\b': 'Commonwealth Act',
      '\\bP\\.D\\.|\\bPD\\b': 'Presidential Decree',
      '\\bA\\.O\\.|\\bAO\\b': 'Administrative Order',
      '\\bB\\.P\\.|\\bBP\\b': 'Batas Pambansa',
      '\\bM\\.C\\.|\\bMC\\b': 'Memorandum Circular',
      '\\bA\\.M\\.|\\bAM\\b': 'Administrative Matter',
      '\\bE\\.O\\.|\\bEO\\b': 'Executive Order',
      // add more mappings as needed
    };

    // Try to extract trailing identifier (numbers, dashes, slashes)
    const idMatch = s.match(/([A-Za-z.\s]{1,10})\s*[:#-]?\s*([0-9][0-9A-Za-z/\-._]*)$/i);
    let idPart = null;
    if (idMatch) {
      idPart = idMatch[2].trim();
    }

    // For each known abbreviation mapping, produce plausible expansions
    for (const [pat, full] of Object.entries(abbrMap)) {
      const re = new RegExp(pat, 'i');
      if (re.test(s)) {
        // if there's an id part, build variations with/without "No." and with canonical spacing
        if (idPart) {
          variants.add(`${full} No. ${idPart}`);
          variants.add(`${full} ${idPart}`);
          variants.add(`${full} No ${idPart}`);
          variants.add(`${full} No.${idPart}`);
        } else {
          // no explicit id, at least add full form
          variants.add(full);
        }
        // also include a cleaned/normalized punctuation variant
        variants.add(s.replace(/\s+/g, ' ').replace(/\./g, '').trim());
      }
    }

    // common transformation: add "No." when a bare abbreviation is followed by digits
    const bareMatch = s.match(/^([A-Za-z.]{1,5})\s*([0-9][0-9A-Za-z/\-._]*)$/i);
    if (bareMatch) {
      const ab = bareMatch[1].replace(/\s+/g, '');
      const id = bareMatch[2];
      // if abbreviation maps to something, add the expansion
      for (const [pat, full] of Object.entries(abbrMap)) {
        if (new RegExp('^' + pat + '$', 'i').test(ab)) {
          variants.add(`${full} No. ${id}`);
          variants.add(`${full} ${id}`);
        }
      }
      // also add a normalized no-dot bare form ("RA 1061")
      variants.add(`${ab} ${id}`);
    }

    // Always include the original trimmed string first
    return Array.from(variants);
  }

  // Pick the best variant to use as an ILIKE title filter.
  // Prefer long-form/full-name variants (e.g., "Republic Act No. 1061"),
  // variants containing "No." or known full keywords, otherwise use the longest variant.
  function chooseBestTitleVariant(variants) {
    if (!Array.isArray(variants) || variants.length === 0) return null;
    // prefer full-name keywords
    const fullKeywords = /(Republic|Presidential|Executive|Administrative|Commonwealth|Batas|Memorandum|Administrative Matter|Administrative Order|Memorandum Circular)/i;
    let candidates = variants.filter((v) => fullKeywords.test(v));
    if (candidates.length === 0) {
      // prefer explicit "No." forms
      candidates = variants.filter((v) => /\bNo\.?\b/i.test(v));
    }
    // fallback to longest variant
    const pool = candidates.length > 0 ? candidates : variants;
    pool.sort((a, b) => b.length - a.length);
    return pool[0];
  }

  if (searchByTitleRaw) {
      // First, run an exact normalized-equality check. If any exact matches
      // exist, return them immediately. Otherwise fall back to the ILIKE
      // substring+vector flow below.
      const exactSql = `
        SELECT e.uuid, m.filename, m.relative_path,
               t.line_index as title_lineIndex, t.title_line, t.evidence, t.type, t.id, t.normalized_title, t.confidence, t.canonical_short
        FROM embeddings e
        LEFT JOIN embeddings_files m USING (uuid)
        LEFT JOIN embeddings_titles t USING (uuid)
        WHERE trim(t.normalized_title) = trim($1)
           OR trim(t.canonical_short) = trim($1)
           OR trim(t.title_line) = trim($1)
        LIMIT $2
      `;

      // Try multiple expanded variants to increase chance of exact hit
      const variants = generateTitleVariants(searchByTitleRaw);
      for (const v of variants) {
        const { rows: exactRows } = await pgClient.query(exactSql, [v, k]);
        if (exactRows && exactRows.length > 0) {
          // Return exact-match rows (read files like usual)
          const limitExact = pLimit(6);
          const exactResults = await Promise.all(
            exactRows.map((r) =>
              limitExact(async () => {
                let text = null;
                try {
                  if (r.filename) {
                    const p = path.join(CORPUS_DIR, r.relative_path || '', r.filename + '.txt');
                    text = await fs.readFile(p, 'utf8');
                  }
                } catch {
                  text = null;
                }
                return {
                  uuid: r.uuid,
                  filename: r.filename,
                  relative_path: r.relative_path,
                  text,
                };
              })
            )
          );
          return exactResults;
        }
      }

      // If no exact textual match, try a targeted identifier-normalization
      // fallback: compare `canonical_short` after removing dots and spaces
      // (preserve other punctuation like dashes). This helps match forms
      // like "A.M. No. 01-2-04-SC" when the DB stores slightly different
      // punctuation/space arrangements.
      const idSql = `
        SELECT e.uuid, m.filename, m.relative_path,
               t.line_index as title_lineIndex, t.title_line, t.evidence, t.type, t.id, t.normalized_title, t.confidence, t.canonical_short
        FROM embeddings e
        LEFT JOIN embeddings_files m USING (uuid)
        LEFT JOIN embeddings_titles t USING (uuid)
        WHERE lower(regexp_replace(t.canonical_short, '[.\\s]+', '', 'g')) = lower(regexp_replace($1, '[.\\s]+', '', 'g'))
           OR lower(regexp_replace(t.title_line, '[.\\s]+', '', 'g')) = lower(regexp_replace($1, '[.\\s]+', '', 'g'))
        LIMIT $2
      `;

      // Try idSql across variants too
      for (const v of variants) {
        const { rows: idRows } = await pgClient.query(idSql, [v, k]);
        if (idRows && idRows.length > 0) {
          const limitId = pLimit(6);
          const idResults = await Promise.all(
            idRows.map((r) =>
              limitId(async () => {
                let text = null;
                try {
                  if (r.filename) {
                    const p = path.join(CORPUS_DIR, r.relative_path || '', r.filename + '.txt');
                    text = await fs.readFile(p, 'utf8');
                  }
                } catch {
                  text = null;
                }
                return {
                  uuid: r.uuid,
                  filename: r.filename,
                  relative_path: r.relative_path,
                  text,
                };
              })
            )
          );
          return idResults;
        }
      }

      // If still no match, try matching by parsed (type, evidence) pairs
      const pair = extractTypeEvidence(searchByTitleRaw);
      if (pair) {
        const typeSql = `
          SELECT e.uuid, m.filename, m.relative_path,
                 t.line_index as title_lineIndex, t.title_line, t.evidence, t.type, t.id, t.normalized_title, t.confidence, t.canonical_short
          FROM embeddings e
          LEFT JOIN embeddings_files m USING (uuid)
          LEFT JOIN embeddings_titles t USING (uuid)
          WHERE (COALESCE(t.type::text, '') ILIKE $1 OR COALESCE(t.type::text, '') ILIKE '%' || $1 || '%')
            AND (COALESCE(t.evidence::text, '') ILIKE $2 OR COALESCE(t.id::text, '') ILIKE $2)
          LIMIT $3
        `;
        const { rows: typeRows } = await pgClient.query(typeSql, [pair.type, pair.evidence, k]);
        if (typeRows && typeRows.length > 0) {
          const limitType = pLimit(6);
          const typeResults = await Promise.all(
            typeRows.map((r) =>
              limitType(async () => {
                let text = null;
                try {
                  if (r.filename) {
                    const p = path.join(CORPUS_DIR, r.relative_path || '', r.filename + '.txt');
                    text = await fs.readFile(p, 'utf8');
                  }
                } catch {
                  text = null;
                }
                return {
                  uuid: r.uuid,
                  filename: r.filename,
                  relative_path: r.relative_path,
                  text,
                };
              })
            )
          );
          return typeResults;
        }
      }

      // no exact match -> fall back to ILIKE-based filter in main query (no normalization)
      // We'll use $3 as the title filter parameter in the vector query below.
      whereClause = `WHERE (
        t.normalized_title ILIKE '%' || $3 || '%'
        OR t.canonical_short ILIKE '%' || $3 || '%'
        OR t.title_line ILIKE '%' || $3 || '%'
      )`;
      // pick the best variant for the ILIKE filter (helps "RA 1061" -> "Republic Act No. 1061")
      const bestVariant = chooseBestTitleVariant(variants) || searchByTitleRaw;
      log(`searchNearest: using title filter variant "${String(bestVariant)}" for query "${searchByTitleRaw}"`);
      // retain the chosen variant for later when we assemble params for the
      // vector query (we don't set `params` here because the embedding must be
      // computed first).
      var titleFilterParam = bestVariant;
  }

  // At this point we've possibly returned early for exact/title/id/type matches.
  // If we reach here we need to run the vector-based SQL. Compute embeddings
  // only now to avoid unnecessary API calls.
  // determine DB vector dim (cached)
  const allowDownsampleQuery = opts.allowDownsample !== false;
  const dbDim = Number(process.env.DOWNSAMPLE_DIM);

  // get embedding only when doing vector search
  const embeddingArr = await getQueryEmbedding(query);
  if (!embeddingArr || embeddingArr.length === 0) return [];

  let embeddingToUse = embeddingArr;
  if (dbDim && embeddingArr.length !== dbDim) {
    if (!allowDownsampleQuery) {
      throw new Error(`different vector dimensions ${embeddingArr.length} and ${dbDim}`);
    }
    // downsample queries to dbDim
    console.log(`Downsampling query embedding ${embeddingArr.length} -> ${dbDim}`);
    embeddingToUse = downsampleEmbedding(embeddingArr, dbDim);
  }

  const vectorStr = '[' + embeddingToUse.join(',') + ']';

  // Assemble params for vector query. If a title filter was requested above
  // we need to pass it as $3.
  if (typeof titleFilterParam !== 'undefined') {
    params = [vectorStr, k, titleFilterParam];
  } else {
    params = [vectorStr, k];
  }

  const sql = `
    SELECT e.uuid, m.filename, m.relative_path,
           t.line_index as title_lineIndex, t.title_line, t.evidence, t.type, t.id, t.normalized_title, t.confidence, t.canonical_short,
           e.embedding <-> $1::vector AS dist
    FROM embeddings e
    LEFT JOIN embeddings_files m USING (uuid)
    LEFT JOIN embeddings_titles t USING (uuid)
    ${whereClause}
    ORDER BY e.embedding <-> $1::vector
    LIMIT $2
  `;

  const { rows } = await pgClient.query(sql, params);

  // Only read file content for the top results, in parallel with concurrency limit
  const limit = pLimit(6); // adjust concurrency
  const results = await Promise.all(
    rows.map((r) =>
      limit(async () => {
        let text = null;
        try {
          if (r.filename) {
            const p = path.join(CORPUS_DIR, r.relative_path || '', r.filename + '.txt');
            text = await fs.readFile(p, 'utf8');
          }
        } catch {
          text = null;
        }
        return {
          uuid: r.uuid,
          filename: r.filename,
          relative_path: r.relative_path,
          text,
        };
      })
    )
  );

  // Reorder results based on dates present in filenames (newest first)
  function extractDateFromFilename(name) {
    if (!name || typeof name !== 'string') return null;
    const s = name.trim();
    // Try YYYY-MM-DD or YYYY_MM_DD or YYYY.MM.DD
    let m = s.match(/(19|20)\d{2}[-_.](0[1-9]|1[0-2])[-_.](0[1-9]|[12]\d|3[01])/);
    if (m) {
      const y = m[0].slice(0,4);
      const mo = m[2];
      const d = m[3];
      return new Date(`${y}-${mo}-${d}`);
    }
    // Try YYYY-MM or YYYY_MM
    m = s.match(/(19|20)\d{2}[-_.](0[1-9]|1[0-2])/);
    if (m) {
      const y = m[0].slice(0,4);
      const mo = m[2];
      return new Date(`${y}-${mo}-01`);
    }
    // Try bare year YYYY
    m = s.match(/\b(19|20)\d{2}\b/);
    if (m) {
      const y = m[0].slice(0,4);
      return new Date(`${y}-01-01`);
    }
    return null;
  }

  results.sort((a, b) => {
    const da = extractDateFromFilename(a?.filename || '');
    const db = extractDateFromFilename(b?.filename || '');
    if (da && db) return db - da; // newest first
    if (da && !db) return -1;
    if (!da && db) return 1;
    return 0;
  });

  return results;
}
