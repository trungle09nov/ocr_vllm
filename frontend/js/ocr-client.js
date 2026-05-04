'use strict';

/**
 * Async generator — yields parsed NDJSON objects from the /process stream.
 *
 * Yielded shapes:
 *   { status: 'processing' }
 *   { page: number, result: vLLMResponse }
 *   { page: number, error: string }
 *   { status: 'done', total_pages: number }
 *
 * Throws on network / HTTP errors.
 */
async function* streamOCR(file, config) {
  const url = new URL(`${config.apiUrl.replace(/\/$/, '')}/process`);
  url.searchParams.set('temperature', config.temperature);
  url.searchParams.set('max_tokens', config.maxTokens);

  const formData = new FormData();
  formData.append('file', file);

  let response;
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      body: formData,
    });
  } catch (err) {
    throw new Error(`Khong the ket noi backend: ${err.message}`);
  }

  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch (_) {}
    throw new Error(`Backend loi ${response.status}: ${detail}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep last incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          yield JSON.parse(trimmed);
        } catch {
          console.warn('[ocr-client] parse error:', trimmed);
        }
      }
    }

    // flush remaining buffer
    if (buffer.trim()) {
      try { yield JSON.parse(buffer.trim()); } catch (_) {}
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Extract markdown string from a vLLM chat completion response object.
 */
function extractMarkdown(vllmResult) {
  return vllmResult?.choices?.[0]?.message?.content ?? '';
}
