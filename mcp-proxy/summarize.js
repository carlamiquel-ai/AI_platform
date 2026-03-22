const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const SNOWFLAKE_ACCOUNT_URL = 'https://fha72713-pa00178.snowflakecomputing.com';
const DEFAULT_MODEL = 'snowflake-llama-3.3-70b';
const MAX_CHUNK_CHARS = 80000;
const CHUNK_OVERLAP = 1000;

/**
 * Extract text from a file buffer based on MIME type.
 * Supports PDF, DOCX, and plain text.
 */
async function extractText(buffer, mimeType) {
  if (mimeType === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimeType === 'text/plain' || mimeType === 'text/csv' || mimeType === 'text/markdown') {
    return buffer.toString('utf-8');
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

/**
 * Split text into chunks with overlap to preserve context at boundaries.
 */
function chunkText(text, maxChars = MAX_CHUNK_CHARS, overlap = CHUNK_OVERLAP) {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxChars;
    if (end < text.length) {
      const lastNewline = text.lastIndexOf('\n', end);
      if (lastNewline > start + maxChars * 0.5) {
        end = lastNewline;
      }
    }
    chunks.push(text.slice(start, end));
    start = end - overlap;
    if (start >= text.length) break;
  }

  return chunks;
}

/**
 * Call Snowflake Cortex COMPLETE via the SQL REST API.
 */
async function callCortexComplete(prompt, apiKey, model = DEFAULT_MODEL) {
  const sqlText = `SELECT SNOWFLAKE.CORTEX.COMPLETE(?, ?) AS summary;`;

  const response = await fetch(`${SNOWFLAKE_ACCOUNT_URL}/api/v2/statements`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT'
    },
    body: JSON.stringify({
      statement: sqlText,
      timeout: 120,
      bindings: {
        '1': { type: 'TEXT', value: model },
        '2': { type: 'TEXT', value: prompt }
      },
      warehouse: 'COMPUTE_WH',
      role: 'TST_ETL_ROLE'
    })
  });

  const result = await response.json();

  if (result.code && result.code !== '090001') {
    throw new Error(`Snowflake SQL API error: ${result.message || JSON.stringify(result)}`);
  }

  // Handle async execution — poll until complete
  if (result.statementStatusUrl) {
    return await pollForResult(result.statementStatusUrl, apiKey);
  }

  // Synchronous result
  if (result.data && result.data.length > 0) {
    return result.data[0][0];
  }

  throw new Error('No result from Cortex COMPLETE');
}

/**
 * Poll Snowflake SQL API for async query results.
 */
async function pollForResult(statusUrl, apiKey, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    const response = await fetch(`${SNOWFLAKE_ACCOUNT_URL}${statusUrl}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT'
      }
    });

    const result = await response.json();

    if (result.data && result.data.length > 0) {
      return result.data[0][0];
    }

    if (result.message && result.message.includes('error')) {
      throw new Error(`Snowflake query failed: ${result.message}`);
    }
  }

  throw new Error('Snowflake query timed out');
}

/**
 * Summarize a document using map-reduce pattern.
 * - Small docs: single COMPLETE call
 * - Large docs: summarize each chunk, then combine summaries
 */
async function summarizeDocument(buffer, mimeType, apiKey, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const format = options.format || 'structured';

  console.log(`[Summarize] Extracting text from ${mimeType}...`);
  const text = await extractText(buffer, mimeType);
  console.log(`[Summarize] Extracted ${text.length} characters`);

  if (text.trim().length === 0) {
    throw new Error('No text content found in document');
  }

  const chunks = chunkText(text);
  console.log(`[Summarize] Split into ${chunks.length} chunk(s)`);

  const systemPrompt = format === 'brief'
    ? 'Summarize the following text in 3-5 bullet points. Be concise.'
    : [
      'You are a document summarization assistant. Provide a structured summary with:',
      '1. Executive Summary (2-3 sentences)',
      '2. Key Points (bullet list)',
      '3. Action Items (if any)',
      '4. Notable Details',
      '',
      'Document:'
    ].join('\n');

  if (chunks.length === 1) {
    // Single chunk — direct summarization
    const prompt = `${systemPrompt}\n\n${chunks[0]}`;
    console.log(`[Summarize] Single-chunk summarization with ${model}...`);
    return await callCortexComplete(prompt, apiKey, model);
  }

  // Map phase: summarize each chunk
  console.log(`[Summarize] Map phase: summarizing ${chunks.length} chunks...`);
  const chunkSummaries = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkPrompt = `Summarize section ${i + 1} of ${chunks.length} from a larger document. Be thorough but concise:\n\n${chunks[i]}`;
    console.log(`[Summarize] Summarizing chunk ${i + 1}/${chunks.length}...`);
    const summary = await callCortexComplete(chunkPrompt, apiKey, model);
    chunkSummaries.push(summary);
  }

  // Reduce phase: combine summaries
  console.log(`[Summarize] Reduce phase: combining ${chunkSummaries.length} summaries...`);
  const reducePrompt = [
    systemPrompt,
    '',
    'The following are summaries of different sections of the same document. Combine them into a single coherent summary:',
    '',
    ...chunkSummaries.map((s, i) => `--- Section ${i + 1} ---\n${s}`)
  ].join('\n');

  return await callCortexComplete(reducePrompt, apiKey, model);
}

module.exports = { extractText, chunkText, callCortexComplete, summarizeDocument };
