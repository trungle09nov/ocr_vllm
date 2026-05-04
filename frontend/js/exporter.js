'use strict';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Strip basic markdown syntax to get readable plain text. */
function markdownToPlain(md) {
  return md
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parse markdown tables into arrays of rows.
 * Returns array of 2D string arrays.
 */
function extractMarkdownTables(md) {
  const tables = [];
  const lines = md.split('\n');
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|')) {
      // Skip separator rows like |---|---|
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue;
      if (!current) current = [];
      const cells = trimmed
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      current.push(cells);
    } else {
      if (current) { tables.push(current); current = null; }
    }
  }
  if (current) tables.push(current);
  return tables;
}

// ─── Export functions ─────────────────────────────────────────────────────────

/** Export selected pages as a single Markdown file. */
function exportMD(basename, pages) {
  const content = pages
    .map((p) => `# Trang ${p.pageNum}\n\n${p.markdown}`)
    .join('\n\n---\n\n');
  downloadBlob(
    new Blob([content], { type: 'text/markdown;charset=utf-8' }),
    `${basename}.md`,
  );
}

/** Export as CSV — one row per page, plain text content. */
function exportCSV(basename, pages) {
  const rows = [['Trang', 'Noi dung']];
  for (const p of pages) {
    const text = markdownToPlain(p.markdown).replace(/\n/g, ' ');
    rows.push([p.pageNum, text]);
  }
  const csv = rows
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  // BOM for Excel UTF-8 compatibility
  downloadBlob(
    new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }),
    `${basename}.csv`,
  );
}

/** Export as XLSX — 3 sheets: overview, full content, extracted tables. */
function exportXLSX(basename, pages) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryRows = [
    ['OCR Export'],
    [],
    ['Tong trang:', pages.length],
    ['Ngay xuat:', new Date().toLocaleString('vi-VN')],
    ['File:', basename],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 15 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Tong quan');

  // Sheet 2: Full content (markdown)
  const contentRows = [['Trang', 'Noi dung Markdown']];
  for (const p of pages) {
    contentRows.push([p.pageNum, p.markdown]);
  }
  const wsContent = XLSX.utils.aoa_to_sheet(contentRows);
  wsContent['!cols'] = [{ wch: 8 }, { wch: 120 }];
  XLSX.utils.book_append_sheet(wb, wsContent, 'Noi dung');

  // Sheet 3: Extracted tables (if any)
  const allTableRows = [];
  for (const p of pages) {
    const tables = extractMarkdownTables(p.markdown);
    if (tables.length === 0) continue;
    for (const table of tables) {
      allTableRows.push([`-- Trang ${p.pageNum} --`]);
      allTableRows.push(...table);
      allTableRows.push([]);
    }
  }
  if (allTableRows.length > 0) {
    const wsTables = XLSX.utils.aoa_to_sheet(allTableRows);
    XLSX.utils.book_append_sheet(wb, wsTables, 'Bang bieu');
  }

  XLSX.writeFile(wb, `${basename}.xlsx`);
}

/**
 * Merge all files' selected pages into one Markdown file.
 * @param {Array<{name: string, pages: PageResult[]}>} fileItems
 */
function exportMergedMD(fileItems) {
  const sections = [];
  for (const item of fileItems) {
    const selected = item.pages.filter((p) => p.selected);
    if (selected.length === 0) continue;
    sections.push(
      `# ${item.name}\n\n` +
      selected.map((p) => `## Trang ${p.pageNum}\n\n${p.markdown}`).join('\n\n---\n\n'),
    );
  }
  const content = sections.join('\n\n===\n\n');
  downloadBlob(
    new Blob([content], { type: 'text/markdown;charset=utf-8' }),
    `ocr_merged_${Date.now()}.md`,
  );
}
