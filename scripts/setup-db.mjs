#!/usr/bin/env node
/*
  scripts/setup-db.mjs

  Create the DB schema used by the project (extensions, tables, indexes).
  Optionally import embeddings JSONL if INPUT_FILE is set — this script does
  NOT require an INPUT_FILE and
  will create the schema even when no input is provided.

  Usage:
    INPUT_FILE=./output/embeddings/embeddings.jsonl node scripts/setup-db.mjs
    node scripts/setup-db.mjs  # only creates schema
*/

import { createReadStream } from 'fs';
import fs from 'fs/promises';
import readline from 'readline';

import { Client } from 'pg';

import { downsampleEmbedding } from '../src/utils/downsample.mjs';


async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const INPUT_FILE = process.env.INPUT_FILE || null;
const DOWNSAMPLE_DIM = process.env.DOWNSAMPLE_DIM ? Number(process.env.DOWNSAMPLE_DIM) : null;

// Prefer explicit DATABASE_URL when available — it commonly comes from platforms
// like Dokku and encodes the full host/port/user/password in one string.
const clientConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 }
  : {
      host: process.env.PGHOST || undefined,
      port: process.env.PGPORT || undefined,
      user: process.env.PGUSER || undefined,
      password: process.env.PGPASSWORD || undefined,
      database: process.env.PGDATABASE || undefined,
      connectionTimeoutMillis: 10000,
    };

// Will be set to the active connected client after a successful connection
let client = null;

function maskedDatabaseURL(url) {
  if (!url) return null;
  return url.replace(/:(.*?)@/, ':****@');
}

async function connectWithRetries(retries = 8, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    const attempt = i + 1;
    let tempClient = new Client(clientConfig);
    try {
      await tempClient.connect();
      // success — replace global client with this connected instance
      client = tempClient;
      return;
    } catch (err) {
      // cleanup temp client if it exists
      try { await tempClient.end(); } catch {
        /* ignore close errors */
      }
      const last = i === retries - 1;
      console.warn(`DB connect attempt ${attempt}/${retries} failed: ${(err && err.message) || err}`);
      if (last) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function tableExists(tableName) {
  const res = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = $1
     )`,
    [tableName]
  );
  return !!res.rows[0].exists;
}

async function getDbEmbeddingDim() {
  try {
    const res = await client.query(`
      SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) AS t
      FROM pg_attribute a
      JOIN pg_class c ON a.attrelid = c.oid
      WHERE c.relname = 'embeddings' AND a.attname = 'embedding'
      LIMIT 1
    `);
    if (!res.rows || !res.rows[0] || !res.rows[0].t) return null;
    const t = res.rows[0].t; // e.g. 'vector(1536)'
    const m = t.match(/vector\((\d+)\)/i);
    if (m) return Number(m[1]);
    return null;
  } catch {
    // if query fails, assume no dimension info
    return null;
  }
}


async function createTablesWithVector(dim, createVectorIndex = true) {
  await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

  let trgmAvailable = false;
  try {
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    trgmAvailable = true;
  } catch {
    console.warn('Warning: pg_trgm extension not available. Falling back to non-trigram indexes.');
    trgmAvailable = false;
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS embeddings (
      uuid UUID PRIMARY KEY,
      embedding vector(${dim}) NOT NULL
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS embeddings_files (
      uuid UUID PRIMARY KEY,
      filename TEXT,
      relative_path TEXT,
      CONSTRAINT fk_embeddings FOREIGN KEY (uuid) REFERENCES embeddings(uuid) ON DELETE CASCADE
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS embeddings_titles (
      uuid UUID PRIMARY KEY REFERENCES embeddings(uuid) ON DELETE CASCADE,
      line_index INTEGER,
      title_line TEXT,
      evidence JSONB,
      type TEXT,
      id TEXT,
      normalized_title TEXT,
      confidence REAL,
      canonical_short TEXT
    );
  `);

  if (createVectorIndex) {
    try {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_embeddings_vector_ivfflat ON embeddings USING ivfflat (embedding) WITH (lists = 100);`);
    } catch (err) {
      console.warn('Failed to create ivfflat index:', err.message || err);
      console.warn('Falling back to no vector index. Search queries will be slower for large datasets.');
    }
  } else {
    console.warn(`Skipping creation of ivfflat vector index because embedding dimension (${dim}) > 2000.`);
  }

  if (trgmAvailable) {
    try {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_files_filename_trgm ON embeddings_files USING GIN (lower(filename) gin_trgm_ops);`);
    } catch (err) {
      console.warn('Failed creating trigram GIN index for filename:', err.message || err);
      try {
        await client.query(`CREATE INDEX IF NOT EXISTS idx_files_filename_btree_lower ON embeddings_files (lower(filename));`);
      } catch (err2) {
        console.warn('Also failed creating fallback btree index for filename:', err2.message || err2);
      }
    }
  } else {
    try {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_files_filename_btree_lower ON embeddings_files (lower(filename));`);
    } catch (err) {
      console.warn('Failed creating fallback btree index for filename:', err.message || err);
    }
  }
}

async function run() {
  try {
    if (process.env.DATABASE_URL) console.log('Attempting to connect using DATABASE_URL=', maskedDatabaseURL(process.env.DATABASE_URL));
    else console.log(`Attempting DB connect host=${process.env.PGHOST || '<unset>'} port=${process.env.PGPORT || '<unset>'}`);
    await connectWithRetries();
    console.log('Connected to DB');
  } catch (err) {
    console.error('Failed to connect to DB after retries:', err.message || err);
    process.exit(1);
  }

  try {
    // Determine a sensible target dimension
    let originalDim = 1536;
    let targetDim = originalDim;

    if (INPUT_FILE) {
      if (await fileExists(INPUT_FILE)) {
        // peek first embedding dimension
        const stream = createReadStream(INPUT_FILE);
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.embedding && Array.isArray(obj.embedding)) {
              originalDim = obj.embedding.length;
              break;
            }
          } catch {
            // ignore parse errors
          }
        }
        rl.close();
      } else {
        console.warn(`INPUT_FILE set (${INPUT_FILE}) but not found — continuing and only creating schema.`);
      }
    } else {
      console.log('No INPUT_FILE provided — only creating schema.');
    }

    targetDim = (DOWNSAMPLE_DIM && Number.isFinite(DOWNSAMPLE_DIM) && DOWNSAMPLE_DIM > 0 && DOWNSAMPLE_DIM < originalDim)
      ? Number(DOWNSAMPLE_DIM)
      : originalDim;

    if (targetDim !== originalDim) console.log(`Config: downsample ${originalDim} -> ${targetDim}`);

    

    
    

    // Only create the embeddings tables/indexes when they don't already exist
    const embeddingsExists = await tableExists('embeddings');
    const metaExists = await tableExists('embeddings_files');

    // If embeddings table exists, query its declared dimension so we can
    // import compatible vectors (downsample or pad inputs when needed).
    let dbEmbeddingDim = null;
    if (embeddingsExists) {
      dbEmbeddingDim = await getDbEmbeddingDim();
      if (dbEmbeddingDim) console.log(`Found existing embeddings column dimension: ${dbEmbeddingDim}`);
    }

    let createVectorIndex = false;
    let finalDim = Number(targetDim);
    const indexWanted = (process.env.PGVECTOR_CREATE_INDEX !== 'false');
    if (embeddingsExists && dbEmbeddingDim) {
      // DB table exists; index only possible if DB dim <= 2000
      createVectorIndex = dbEmbeddingDim <= 2000 && indexWanted;
      finalDim = dbEmbeddingDim;
    } else {
      // No existing table; we can choose a smaller finalDim to allow indexing
      if (finalDim <= 2000) {
        createVectorIndex = indexWanted;
      } else if (indexWanted) {
        // choose a safe indexable dim (use DOWNSAMPLE_DIM if provided; otherwise default 1536)
        const envIdx = Number.isFinite(Number(DOWNSAMPLE_DIM)) && Number(DOWNSAMPLE_DIM) > 0 ? Number(DOWNSAMPLE_DIM) : 1536;
        const chosen = envIdx;
        if (chosen <= 2000) {
          console.log(`Target dim ${finalDim} > 2000 — downsampling to ${chosen} so a vector index can be created`);
          finalDim = chosen;
          createVectorIndex = true;
        } else {
          console.warn(`Requested index dimension ${chosen} is >2000 — skipping vector index`);
          createVectorIndex = false;
        }
      } else {
        createVectorIndex = false;
      }
    }

    

    if (!embeddingsExists || !metaExists) {
      console.log('embeddings / embeddings_files missing -> creating schema');
      console.log(`Creating embeddings with vector dim ${finalDim} (indexable=${createVectorIndex})`);
      await createTablesWithVector(finalDim, createVectorIndex);
      // If we've just created the table, this is now the DB embedding dim
      if (!dbEmbeddingDim) dbEmbeddingDim = finalDim;
      // ensure we insert using the final dimension (may be downsampled for index)
      targetDim = finalDim;
      // If we've just created the table, this is now the DB embedding dim
      if (!dbEmbeddingDim) dbEmbeddingDim = targetDim;
    } else {
      console.log('embeddings & embeddings_files already exist — ensuring indexes');
      if (createVectorIndex) {
        try {
          await client.query(`CREATE INDEX IF NOT EXISTS idx_embeddings_vector_ivfflat ON embeddings USING ivfflat (embedding) WITH (lists = 100);`);
        } catch (err) {
          console.warn('Unable to create ivfflat index on existing table:', err.message || err);
          console.warn('Search may be slower; consider re-embedding or enabling PGVECTOR_CREATE_INDEX.');
        }
      } else {
        console.warn(`Not creating vector index: embeddings dimension (${targetDim}) > 2000.`);
      }
    }

    // If the DB already has an embeddings dimension (dbEmbeddingDim) and it's
    // different from the input dim, enforce the DB dim as target for inserts.
    if (dbEmbeddingDim) {
      if (DOWNSAMPLE_DIM && Number.isFinite(DOWNSAMPLE_DIM) && Number(DOWNSAMPLE_DIM) !== dbEmbeddingDim) {
        console.log(`DB embedding dim ${dbEmbeddingDim} detected — ignoring DOWNSAMPLE_DIM ${DOWNSAMPLE_DIM} and using DB dimension`);
      }
      // update targetDim to match DB (we will downsample/pad inputs to this)
      targetDim = dbEmbeddingDim;
    }

    // Also ensure suggestion tables exist (create inlined here so we don't need a
    // separate script file). Create only when missing so we avoid dropping existing data.
    const suggestionsExists = await tableExists('suggestions');
    const suggestionsMetaExists = await tableExists('suggestions_meta');
    async function createSuggestionTablesIfMissing() {
      if (!suggestionsExists) {
        console.log('Creating suggestions table...');
        await client.query(`
          CREATE TABLE IF NOT EXISTS suggestions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            category VARCHAR(50) NOT NULL DEFAULT 'general'
          );
        `);
        console.log('suggestions table created');
      } else {
        console.log('suggestions table already exists');
      }

      if (!suggestionsMetaExists) {
        console.log('Creating suggestions_meta table...');
        await client.query(`
          CREATE TABLE IF NOT EXISTS suggestions_meta (
            id INT PRIMARY KEY DEFAULT 1,
            date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CHECK (id = 1)
          );
        `);
        console.log('suggestions_meta table created');
      } else {
        console.log('suggestions_meta table already exists');
      }
    }

    if (!suggestionsExists || !suggestionsMetaExists) {
      try {
        await createSuggestionTablesIfMissing();
        console.log('Suggestion tables ensured');
      } catch (err) {
        console.warn('Failed to create suggestion tables:', err?.message || err);
      }
    } else {
      console.log('suggestions tables already exist — skipping');
    }

    // If input file present, optionally import (use reduced importer behavior)
    if (INPUT_FILE && (await fileExists(INPUT_FILE))) {
      console.log('Importing from provided INPUT_FILE ...');

      // Use a lightweight streaming importer (based on previous importer logic)
      const stream = createReadStream(INPUT_FILE);
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      const BATCH = 10000;
      let batch = [];
      let totalProcessed = 0;
      let totalSkipped = 0;

      for await (const line of rl) {
        if (!line.trim()) continue;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          totalSkipped++;
          continue;
        }
        let embedding = obj.embedding || null;
        if (!Array.isArray(embedding) || embedding.length === 0) {
          totalSkipped++;
          continue;
        }
        embedding = embedding.map((v) => (typeof v === 'number' ? v : Number(v)));
        // Adjust embedding length to final targetDim — downsample or pad with zeros.
        const adjustEmbeddingToDim = (arr, finalDim) => {
          if (!Array.isArray(arr)) return arr;
          const orig = arr.length;
          if (!finalDim || finalDim === orig) return arr.slice();
          if (orig > finalDim) return downsampleEmbedding(arr, finalDim);
          // orig < finalDim -> pad with zeros
          const out = arr.slice();
          for (let i = orig; i < finalDim; i++) out.push(0);
          return out;
        };

        const embeddingToInsert = adjustEmbeddingToDim(embedding, targetDim);
        batch.push({ uuid: obj.uuid, embedding: embeddingToInsert, filename: obj.filename || null, relative_path: obj.relative_path || null, extracted_title: obj.extracted_title || null });

        if (batch.length >= BATCH) {
          await insertBatch(batch);
          totalProcessed += batch.length;
          console.log(`Inserted ${totalProcessed} (skipped ${totalSkipped})`);
          batch = [];
        }
      }
      if (batch.length > 0) {
        await insertBatch(batch);
        totalProcessed += batch.length;
      }
      console.log(`Finished import: ${totalProcessed} inserted, ${totalSkipped} skipped`);
    }

    console.log('setup-db: done');
  } catch (err) {
    console.error('Fatal:', err.message || err);
    process.exitCode = 1;
  } finally {
    if (client) {
      try { await client.end(); } catch {
        /* ignore close errors */
      }
    }
  }
}

async function insertBatch(records) {
    try {
      await client.query('BEGIN');
      for (const rec of records) {
        const embeddingParam = '[' + rec.embedding.join(',') + ']';
        await client.query(
          `INSERT INTO embeddings (uuid, embedding) VALUES ($1, $2::vector) ON CONFLICT (uuid) DO UPDATE SET embedding = EXCLUDED.embedding`,
          [rec.uuid, embeddingParam]
        );
        await client.query(
          `INSERT INTO embeddings_files (uuid, filename, relative_path) VALUES ($1, $2, $3) ON CONFLICT (uuid) DO UPDATE SET filename = EXCLUDED.filename, relative_path = EXCLUDED.relative_path`,
          [rec.uuid, rec.filename, rec.relative_path]
        );
        if (rec.extracted_title) {
          const t = rec.extracted_title;
          await client.query(
            `INSERT INTO embeddings_titles (uuid, line_index, title_line, evidence, type, id, normalized_title, confidence, canonical_short) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) ON CONFLICT (uuid) DO UPDATE SET line_index = EXCLUDED.line_index, title_line = EXCLUDED.title_line, evidence = EXCLUDED.evidence, type = EXCLUDED.type, id = EXCLUDED.id, normalized_title = EXCLUDED.normalized_title, confidence = EXCLUDED.confidence, canonical_short = EXCLUDED.canonical_short`,
            [rec.uuid, t.lineIndex ?? null, t.titleLine ?? null, JSON.stringify(t.evidence || null), t.type ?? null, t.id ?? null, t.normalized_title ?? null, t.confidence ?? null, t.canonical_short ?? null]
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`DB error inserting batch: ${err.message}`);
    }
  }

await run();
