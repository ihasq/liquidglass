/**
 * Recorder Worker — OPFS-backed crash-resilient interaction logger.
 *
 * Receives frame snapshots from the main thread and persists them to an
 * OPFS file as NDJSON (newline-delimited JSON). Each line is a complete,
 * self-contained record so the file remains parseable even if the page
 * crashes mid-write.
 *
 * Crash resilience strategy:
 *   • createSyncAccessHandle() is used (Worker-only API, ~10x faster than
 *     createWritable for repeated small writes).
 *   • Each batch posted from main is appended at the current EOF and
 *     immediately .flush()'d, so the file is durable on disk after each
 *     postMessage round-trip (typically every rAF, ~16ms).
 *   • SIGILL in the main thread does NOT terminate the worker — the
 *     dedicated worker keeps running and any in-flight messages already
 *     queued in postMessage are processed before the worker exits.
 *
 * File layout under OPFS:
 *   /parameter-lab-recordings/
 *     session-2026-04-19T00-00-00-000Z.ndjson
 *     session-2026-04-19T00-05-23-491Z.ndjson
 *     ...
 *
 * Message protocol:
 *   Main → Worker:
 *     { type: 'init',   sessionId, meta }
 *     { type: 'append', records: [...]  }   // batched per rAF
 *     { type: 'flush'   }
 *     { type: 'list'    }
 *     { type: 'read',   sessionId }
 *     { type: 'delete', sessionId }
 *   Worker → Main:
 *     { type: 'ready' }
 *     { type: 'list',  sessions: [{ name, size, lastModified }] }
 *     { type: 'data',  sessionId, content }
 *     { type: 'stats', bytesWritten, recordCount }
 *     { type: 'error', message }
 */

const DIR_NAME = 'parameter-lab-recordings';

let _dirHandle = null;
let _sessionFile = null;       // FileSystemFileHandle
let _sah = null;               // FileSystemSyncAccessHandle
let _writePosition = 0;
let _bytesWritten = 0;
let _recordCount = 0;
let _statsTimer = null;
const _encoder = new TextEncoder();

/** Acquire (or create) the recordings directory under OPFS root. */
async function getDir() {
  if (_dirHandle) return _dirHandle;
  const root = await navigator.storage.getDirectory();
  _dirHandle = await root.getDirectoryHandle(DIR_NAME, { create: true });
  return _dirHandle;
}

async function initSession(sessionId, meta) {
  const dir = await getDir();
  // sessionId is supplied by main but we sanitize for filename safety.
  const safe = String(sessionId).replace(/[^A-Za-z0-9_.-]/g, '_');
  const fileName = `session-${safe}.ndjson`;

  // Close any prior session file (worker reused across sessions).
  closeSession();

  _sessionFile = await dir.getFileHandle(fileName, { create: true });
  _sah = await _sessionFile.createSyncAccessHandle();
  // Truncate (start clean) — each session = its own file.
  _sah.truncate(0);
  _writePosition = 0;
  _bytesWritten = 0;
  _recordCount = 0;

  // First record: session metadata
  appendOneSync({
    t: 0,
    type: 'init',
    sessionId,
    startedAt: Date.now(),
    ...meta,
  });

  scheduleStatsBeacon();
  postMessage({ type: 'ready', sessionId, fileName });
}

function closeSession() {
  if (_statsTimer) { clearInterval(_statsTimer); _statsTimer = null; }
  if (_sah) {
    try { _sah.flush(); _sah.close(); } catch { /* already closed */ }
    _sah = null;
  }
  _sessionFile = null;
}

/** Append a single JSON-serializable record as one NDJSON line. */
function appendOneSync(record) {
  if (!_sah) return;
  const line = JSON.stringify(record) + '\n';
  const bytes = _encoder.encode(line);
  // SyncAccessHandle.write returns the number of bytes written.
  _sah.write(bytes, { at: _writePosition });
  _writePosition += bytes.byteLength;
  _bytesWritten += bytes.byteLength;
  _recordCount++;
}

/** Append a batch (typical: one rAF's worth of records). */
function appendBatch(records) {
  if (!_sah) return;
  if (!records.length) return;
  // Concatenate all lines, write in one syscall, then flush so the page
  // remains durable on a SIGILL between rAFs.
  let total = 0;
  const chunks = new Array(records.length);
  for (let i = 0; i < records.length; i++) {
    const line = JSON.stringify(records[i]) + '\n';
    const bytes = _encoder.encode(line);
    chunks[i] = bytes;
    total += bytes.byteLength;
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
  _sah.write(merged, { at: _writePosition });
  _writePosition += total;
  _bytesWritten += total;
  _recordCount += records.length;
  // Durable flush after every batch — this is the "細書き" guarantee.
  _sah.flush();
}

function scheduleStatsBeacon() {
  if (_statsTimer) return;
  _statsTimer = setInterval(() => {
    postMessage({
      type: 'stats',
      bytesWritten: _bytesWritten,
      recordCount: _recordCount,
    });
  }, 1000);
}

async function listSessions() {
  const dir = await getDir();
  const sessions = [];
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file') continue;
    if (!entry.name.endsWith('.ndjson')) continue;
    const file = await entry.getFile();
    sessions.push({
      name: entry.name,
      size: file.size,
      lastModified: file.lastModified,
    });
  }
  sessions.sort((a, b) => b.lastModified - a.lastModified);
  postMessage({ type: 'list', sessions });
}

async function readSession(sessionId) {
  const dir = await getDir();
  const safe = String(sessionId).replace(/[^A-Za-z0-9_.-]/g, '_');
  const fileName = `session-${safe}.ndjson`;
  let handle;
  try { handle = await dir.getFileHandle(fileName); }
  catch { postMessage({ type: 'error', message: `Session not found: ${sessionId}` }); return; }
  const file = await handle.getFile();
  const text = await file.text();
  postMessage({ type: 'data', sessionId, content: text });
}

async function deleteSession(sessionId) {
  const dir = await getDir();
  const safe = String(sessionId).replace(/[^A-Za-z0-9_.-]/g, '_');
  const fileName = `session-${safe}.ndjson`;
  try { await dir.removeEntry(fileName); }
  catch (e) { postMessage({ type: 'error', message: `Delete failed: ${e.message}` }); return; }
  await listSessions();
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init':   await initSession(msg.sessionId, msg.meta); break;
      case 'append': appendBatch(msg.records); break;
      case 'flush':
        if (_sah) _sah.flush();
        postMessage({
          type: 'stats', bytesWritten: _bytesWritten, recordCount: _recordCount,
        });
        break;
      case 'list':   await listSessions(); break;
      case 'read':   await readSession(msg.sessionId); break;
      case 'delete': await deleteSession(msg.sessionId); break;
      case 'close':  closeSession(); break;
      default: postMessage({ type: 'error', message: `Unknown msg: ${msg.type}` });
    }
  } catch (err) {
    postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
