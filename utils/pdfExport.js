import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';

// ── Identify "workflow status" history entries (submission/approval/rejection) ──
// These record workflow events, not actual document version changes, so they
// are excluded from the Version History table on the final PDF page.
// Only entries that represent the document's content/version itself —
// e.g. "Initial version v1.0" or "Revised version v1.1" / "Content updated —
// version bumped to v1.1" — should remain.
const WORKFLOW_STATUS_PATTERNS = [
  /^Submitted for sequential approval/i,
  /^Approved via sequential workflow/i,
  /^Rejected at step/i,
];

export function isWorkflowStatusEntry(changeNote) {
  const note = changeNote || '';
  return WORKFLOW_STATUS_PATTERNS.some(re => re.test(note));
}

export function filterVersionHistory(history = []) {
  return history.filter(h => !isWorkflowStatusEntry(h.change_note));
}

// ── HTML → plain text (for rendering Quill rich-text scope in PDF) ────────────
export function htmlToPlainText(html) {
  if (!html) return '';
  let text = html
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

// ── Font/size mapping: editor whitelist → PDF-renderable equivalents ─────────
// jsPDF only ships three built-in font families (Helvetica, Times, Courier) —
// it can't render Arial, Georgia, Verdana, etc. as their true typefaces
// without embedding actual font files, which this app doesn't bundle. Each
// editor font is mapped to its nearest built-in family instead, so the
// *category* of font (sans-serif / serif / monospace) still comes through
// distinctly in the PDF even though the exact typeface doesn't match pixel
// for pixel what's shown on screen.
const PDF_FONT_MAP = {
  arial: 'helvetica', verdana: 'helvetica', calibri: 'helvetica', tahoma: 'helvetica',
  georgia: 'times', 'times-new-roman': 'times',
  'courier-new': 'courier',
};
const DEFAULT_PDF_FONT = 'helvetica';

// Editor size whitelist is in CSS px (matching the toolbar in
// RichTextEditor.jsx) — convert to PDF points using the standard 96px/72pt
// (0.75) ratio used throughout web-to-print tooling.
function pxSizeToPt(px) {
  const n = parseFloat(px);
  return Number.isFinite(n) ? n * 0.75 : null;
}

function pdfFontFor(editorFontSlug) {
  return PDF_FONT_MAP[editorFontSlug] || DEFAULT_PDF_FONT;
}

// ── HTML → sequence of typed blocks (paragraph-with-runs / table) ────────────
// Quill content (Scope field, created document attachments) can contain real
// <table> elements pasted from Word/Excel or inserted via the editor's
// "Insert Table" button, plus inline formatting (bold/italic/underline,
// font, size, color, highlight) from the toolbar. This parser walks the
// actual DOM (via DOMParser, not regex) so nested/mixed formatting is
// handled correctly, and splits the content into an ordered list of blocks:
//   { type: 'paragraph', runs: [{ text, bold, italic, underline, font, sizePt, color, background }, ...] }
//   { type: 'table', rows: [['cell','cell'], ['cell','cell']] }
// so the PDF renderer can draw each block appropriately — wrapped, styled
// text runs for paragraphs, a real autoTable grid for tables.
export function htmlToRichBlocks(html) {
  if (!html || !html.trim()) return [];
  if (typeof DOMParser === 'undefined') {
    // Fall back to the plain-text path in non-browser contexts (shouldn't
    // happen in practice — pdf generation only ever runs client-side).
    return htmlToBlocks(html);
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [];

  // Collect inline formatting state by walking up from a text node through
  // its ancestor elements within the current paragraph/block container.
  function collectRunsFromBlock(el) {
    const runs = [];
    function walk(node, state) {
      if (node.nodeType === 3) { // Text node
        const text = node.textContent;
        if (text) runs.push({ text, ...state });
        return;
      }
      if (node.nodeType !== 1) return; // skip comments etc.
      const tag = node.tagName.toLowerCase();
      if (tag === 'br') { runs.push({ text: '\n', ...state }); return; }

      const next = { ...state };
      if (tag === 'strong' || tag === 'b') next.bold = true;
      if (tag === 'em' || tag === 'i') next.italic = true;
      if (tag === 'u') next.underline = true;
      if (tag === 's' || tag === 'strike' || tag === 'del') next.strike = true;

      const cls = node.classList || [];
      for (const c of cls) {
        if (c.startsWith('ql-font-')) next.font = c.slice('ql-font-'.length);
        if (c.startsWith('ql-size-')) next.sizePt = pxSizeToPt(c.slice('ql-size-'.length));
      }

      const style = node.getAttribute && node.getAttribute('style');
      if (style) {
        const colorMatch = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
        if (colorMatch) next.color = colorMatch[1].trim();
        const bgMatch = /background-color\s*:\s*([^;]+)/i.exec(style);
        if (bgMatch) next.background = bgMatch[1].trim();
      }

      for (const child of node.childNodes) walk(child, next);
    }
    walk(el, {});
    return runs;
  }

  function blockTextAlign(el) {
    const style = el.getAttribute && el.getAttribute('style');
    if (style && /text-align\s*:\s*center/i.test(style)) return 'center';
    if (style && /text-align\s*:\s*right/i.test(style)) return 'right';
    if (style && /text-align\s*:\s*justify/i.test(style)) return 'justify';
    return 'left';
  }

  function walkTopLevel(container) {
    for (const node of container.childNodes) {
      if (node.nodeType === 1 && node.tagName.toLowerCase() === 'table') {
        const rows = [];
        for (const tr of node.querySelectorAll('tr')) {
          const cells = [];
          for (const cell of tr.querySelectorAll('td, th')) {
            const text = (cell.textContent || '').replace(/\s+/g, ' ').trim();
            const colspan = parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
            cells.push(colspan > 1 ? { content: text, colSpan: colspan } : text);
          }
          if (cells.length) rows.push(cells);
        }
        if (rows.length) blocks.push({ type: 'table', rows });
      } else if (node.nodeType === 1 && node.tagName.toLowerCase() === 'img') {
        // A bare top-level <img> (uncommon — Quill normally wraps images in
        // a <p>, handled below — but handle this directly too for safety).
        if (node.getAttribute('src')) blocks.push({ type: 'image', src: node.getAttribute('src') });
      } else if (node.nodeType === 1 && node.querySelector && node.querySelector('img')) {
        // A paragraph/div containing one or more images (the normal case —
        // Quill wraps a pasted/inserted image as <p><img></p>). Images can't
        // be laid out as inline text runs the way bold/italic can, so split
        // this block at each image: any text/formatting before or after the
        // image(s) still becomes its own paragraph block, and each image
        // becomes a dedicated image block in between, preserving order.
        let textBuffer = [];
        function flushTextBuffer() {
          if (textBuffer.length && textBuffer.some(r => r.text.trim())) {
            blocks.push({ type: 'paragraph', runs: textBuffer, align: blockTextAlign(node), headerLevel: null });
          }
          textBuffer = [];
        }
        function walkForImages(n, state) {
          if (n.nodeType === 3) {
            if (n.textContent) textBuffer.push({ text: n.textContent, ...state });
            return;
          }
          if (n.nodeType !== 1) return;
          const t = n.tagName.toLowerCase();
          if (t === 'img') {
            flushTextBuffer();
            if (n.getAttribute('src')) blocks.push({ type: 'image', src: n.getAttribute('src') });
            return;
          }
          if (t === 'br') { textBuffer.push({ text: '\n', ...state }); return; }
          const next = { ...state };
          if (t === 'strong' || t === 'b') next.bold = true;
          if (t === 'em' || t === 'i') next.italic = true;
          if (t === 'u') next.underline = true;
          for (const child of n.childNodes) walkForImages(child, next);
        }
        walkForImages(node, {});
        flushTextBuffer();
      } else if (node.nodeType === 1 && (node.tagName.toLowerCase() === 'ul' || node.tagName.toLowerCase() === 'ol')) {
        // Lists (from both the in-app editor and converted Word documents)
        // must be walked item-by-item — collectRunsFromBlock() flattens all
        // descendant text with no item boundaries, which previously caused
        // every <li> in a list to be silently merged into one run-on
        // paragraph with no markers and no separation between items at all.
        walkList(node, 0);
      } else if (node.nodeType === 1) {
        const tag = node.tagName.toLowerCase();
        const isListItem = tag === 'li';
        const runs = collectRunsFromBlock(node);
        if (runs.length && runs.some(r => r.text.trim())) {
          if (isListItem) runs.unshift({ text: '• ' });
          let headerLevel = null;
          if (/^h[1-3]$/.test(tag)) headerLevel = parseInt(tag[1], 10);
          blocks.push({ type: 'paragraph', runs, align: blockTextAlign(node), headerLevel });
        }
      }
      // Bare text nodes at the top level (rare, but possible with minimal HTML)
      else if (node.nodeType === 3 && node.textContent.trim()) {
        blocks.push({ type: 'paragraph', runs: [{ text: node.textContent }], align: 'left', headerLevel: null });
      }
    }
  }

  // Walks a <ul>/<ol>, pushing one paragraph block per direct <li>, with the
  // correct marker (1. 2. 3. for <ol>, • for <ul>) and a 2-space indent per
  // nesting depth. A nested <ul>/<ol> inside an <li> is walked recursively
  // at depth+1 immediately after that item's own text, preserving the
  // original document order rather than flattening everything together.
  function walkList(listEl, depth) {
    const ordered = listEl.tagName.toLowerCase() === 'ol';
    let n = 0;
    for (const li of listEl.children) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      n++;
      const marker = ordered ? `${n}. ` : '• ';
      const indent = '    '.repeat(depth);
      // Collect this <li>'s own text runs, but NOT its nested list (handled
      // separately below) — collectRunsFromBlock() would otherwise pull a
      // nested list's text into the same run sequence as the parent item.
      const nestedList = Array.from(li.children).find(c => ['ul', 'ol'].includes(c.tagName.toLowerCase()));
      let runs;
      if (nestedList) {
        // Build a temporary clone with the nested list removed, so
        // collectRunsFromBlock only sees this item's own direct content.
        const clone = li.cloneNode(true);
        const nestedInClone = Array.from(clone.children).find(c => ['ul', 'ol'].includes(c.tagName.toLowerCase()));
        if (nestedInClone) clone.removeChild(nestedInClone);
        runs = collectRunsFromBlock(clone);
      } else {
        runs = collectRunsFromBlock(li);
      }
      if (runs.length && runs.some(r => r.text.trim())) {
        runs.unshift({ text: indent + marker });
        blocks.push({ type: 'paragraph', runs, align: 'left', headerLevel: null });
      }
      if (nestedList) walkList(nestedList, depth + 1);
    }
  }

  walkTopLevel(doc.body);
  return blocks;
}

// ── HTML → sequence of typed blocks (text / table) ────────────────────────────
// Quill content (Scope field, created document attachments) can contain real
// <table> elements pasted from Word/Excel or inserted via the editor's
// "Insert Table" button. Naively stripping tags with htmlToPlainText() turns
// a table into one unreadable run-on line. This parser instead walks the
// top-level HTML and splits it into an ordered list of blocks:
//   { type: 'text',  content: '...plain text with paragraph breaks...' }
//   { type: 'table', rows: [['cell','cell'], ['cell','cell']] }
// so the PDF renderer can draw each block with the right method (wrapped
// text vs. a real autoTable grid).
//
// Kept as a fallback for non-browser contexts and for table-cell text
// (which is intentionally rendered as plain text, not styled runs, to keep
// table layout predictable) — paragraph content now goes through
// htmlToRichBlocks() above instead, which preserves formatting.
export function htmlToBlocks(html) {
  if (!html || !html.trim()) return [];

  // Split on table elements, keeping the tables themselves as separators
  const parts = html.split(/(<table[\s\S]*?<\/table>)/gi);
  const blocks = [];

  for (const part of parts) {
    if (!part || !part.trim()) continue;

    if (/^<table/i.test(part.trim())) {
      const rows = [];
      const rowMatches = part.match(/<tr[\s\S]*?<\/tr>/gi) || [];
      for (const rowHtml of rowMatches) {
        const cellMatches = rowHtml.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || [];
        const cells = cellMatches.map(cellHtml => {
          const inner = cellHtml.replace(/^<t[dh][^>]*>/i, '').replace(/<\/t[dh]>$/i, '');
          const text = htmlToPlainText(inner).replace(/\n+/g, ' ').trim();
          const colspanMatch = /colspan\s*=\s*["']?(\d+)/i.exec(cellHtml);
          const colspan = colspanMatch ? Math.max(1, parseInt(colspanMatch[1], 10)) : 1;
          return colspan > 1 ? { content: text, colSpan: colspan } : text;
        });
        if (cells.length) rows.push(cells);
      }
      if (rows.length) blocks.push({ type: 'table', rows });
    } else {
      const text = htmlToPlainText(part);
      if (text.trim()) blocks.push({ type: 'text', content: text });
    }
  }

  return blocks;
}

// ── Hex color → RGB array (for pdf.setFillColor/setDrawColor) ────────────────
function hexToRgb(hex, fallback = [26, 86, 219]) {
  if (!hex) return fallback;
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return fallback;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

// Quill writes inline color/background-color as CSS `rgb(r, g, b)` strings
// (not hex), so this handles both formats — used when rendering styled text
// runs in the PDF so font color / highlight match what's shown in the editor.
function cssColorToRgb(css, fallback = null) {
  if (!css) return fallback;
  const rgbMatch = /rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(css);
  if (rgbMatch) return [parseInt(rgbMatch[1], 10), parseInt(rgbMatch[2], 10), parseInt(rgbMatch[3], 10)];
  const hexMatch = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(css.trim());
  if (hexMatch) return [parseInt(hexMatch[1], 16), parseInt(hexMatch[2], 16), parseInt(hexMatch[3], 16)];
  return fallback;
}

// ── Watermark stamper ─────────────────────────────────────────────────────────
function stampWatermark(pdf, text, color = '#1A56DB') {
  const totalPages = pdf.internal.getNumberOfPages();
  const { width, height } = pdf.internal.pageSize;
  const cx = width / 2;
  const cy = height / 2;

  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.saveGraphicsState();
    pdf.setGState(new pdf.GState({ opacity: 0.10 }));
    pdf.setTextColor(color);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(44);
    [-1, 0, 1].forEach(row => {
      [-1, 0, 1].forEach(col => {
        pdf.text(text, cx + col * 140, cy + row * 100, { angle: 45, align: 'center' });
      });
    });
    pdf.restoreGraphicsState();
    pdf.setTextColor('#000000');
  }
}

// ── Company logo — draws uploaded logo image, or falls back to CognifAI "C" badge ──
// settings.company_logo is a base64 data URL (e.g. "data:image/png;base64,...")
function drawCompanyLogo(pdf, x, y, size = 14, settings = {}) {
  const logoDataUrl = settings.company_logo;
  if (logoDataUrl) {
    try {
      // Detect format from data URL prefix
      const match = /^data:image\/(\w+);base64,/.exec(logoDataUrl);
      const format = match ? match[1].toUpperCase().replace('JPEG', 'JPEG').replace('SVG+XML', 'PNG') : 'PNG';
      // jsPDF addImage supports PNG/JPEG; fall back to PNG for unsupported formats
      const safeFormat = ['PNG','JPEG','JPG','WEBP'].includes(format) ? format : 'PNG';
      pdf.addImage(logoDataUrl, safeFormat, x, y, size, size);
      return;
    } catch (e) {
      // Fall through to default badge on any error (e.g. unsupported SVG)
    }
  }
  // Default — CognifAI "C" badge drawn as vector shapes
  pdf.setFillColor(26, 86, 219);
  pdf.circle(x + size/2, y + size/2, size/2, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(size * 0.95);
  pdf.setTextColor('#FFFFFF');
  pdf.text('C', x + size/2, y + size/2 + size*0.32, { align: 'center' });
  pdf.setTextColor('#000000');
}

// ── Page header (used on content pages, not the cover) ───────────────────────
function addPageHeader(pdf, title, subtitle, settings = {}) {
  const [r,g,b] = hexToRgb(settings.cover_brand_color);
  pdf.setFillColor(r, g, b);
  pdf.rect(0, 0, pdf.internal.pageSize.width, 14, 'F');
  drawCompanyLogo(pdf, 3, 2, 10, settings);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor('#FFFFFF');
  pdf.text(title, 17, 9);
  if (subtitle) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text(subtitle, pdf.internal.pageSize.width - 14, 9, { align: 'right' });
  }
  pdf.setTextColor('#000000');
}

// ── Page footer with "Page X of Y" — Y filled in later via finalizePageNumbers ──
function addPageFooter(pdf, pageNote) {
  const { width, height } = pdf.internal.pageSize;
  pdf.setFontSize(7);
  pdf.setTextColor('#9B9890');
  pdf.text(pageNote, 14, height - 6);
  pdf.text(`Generated: ${new Date().toLocaleString('en-IN')}`, width - 14, height - 6, { align: 'right' });
  // Page number placeholder — written for real in finalizePageNumbers()
  pdf.setTextColor('#000000');
}

// ── Stamp "Page X of Y" on every page (call once at the very end) ─────────────
function finalizePageNumbers(pdf) {
  const total = pdf.internal.getNumberOfPages();
  const { width, height } = pdf.internal.pageSize;
  for (let i = 1; i <= total; i++) {
    pdf.setPage(i);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor('#6B6960');
    pdf.text(`Page ${i} of ${total}`, width / 2, height - 6, { align: 'center' });
    pdf.setTextColor('#000000');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COVER PAGE — CognifAI branding, document title, version
// ─────────────────────────────────────────────────────────────────────────────
function addCoverPage(pdf, doc, settings = {}) {
  const { width, height } = pdf.internal.pageSize;
  const cx = width / 2;
  const companyName = settings.company_name?.trim() || 'CognifAI';
  const [r,g,b] = hexToRgb(settings.cover_brand_color);
  const brandHex = settings.cover_brand_color?.trim() || '#1A56DB';
  const font = ['helvetica','times','courier'].includes(settings.cover_font) ? settings.cover_font : 'helvetica';
  const titleAlign = ['left','center','right'].includes(settings.cover_title_align) ? settings.cover_title_align : 'center';
  const titleSize = Number(settings.cover_title_size) || 22;
  const tagline = settings.cover_tagline?.trim();
  const showStatus = settings.cover_show_status !== 'false';
  const showDates  = settings.cover_show_dates !== 'false';
  const showOwner  = settings.cover_show_owner !== 'false';

  // x-position and align for title block based on chosen alignment
  const titleX = titleAlign === 'left' ? 20 : titleAlign === 'right' ? width - 20 : cx;
  const maxTitleWidth = titleAlign === 'center' ? width - 60 : width - 40;

  // Top brand bar
  pdf.setFillColor(r, g, b);
  pdf.rect(0, 0, width, 50, 'F');

  // Logo (large, centered near top)
  drawCompanyLogo(pdf, cx - 12, 12, 24, settings);

  // Company name
  pdf.setFont(font, 'bold');
  pdf.setFontSize(20);
  pdf.setTextColor('#FFFFFF');
  pdf.text(companyName, cx, 45, { align: 'center' });

  pdf.setTextColor('#000000');

  // Tagline (below brand bar)
  let nextY = 58;
  if (tagline) {
    pdf.setFont(font, 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor('#6B6960');
    pdf.text(tagline, cx, nextY, { align: 'center' });
    pdf.setTextColor('#000000');
    nextY += 8;
  }

  // Document title block
  pdf.setFont(font, 'bold');
  pdf.setFontSize(titleSize);
  const titleLines = pdf.splitTextToSize(doc.title, maxTitleWidth);
  const titleY = Math.max(height * 0.38, nextY + 20);
  pdf.text(titleLines, titleX, titleY, { align: titleAlign });

  // Document ID
  pdf.setFont(font, 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor('#6B6960');
  pdf.text(doc.id, titleX, titleY + titleLines.length * (titleSize * 0.42) + 8, { align: titleAlign });

  // Version badge (always centered, regardless of title alignment)
  const badgeY = titleY + titleLines.length * (titleSize * 0.42) + 22;
  pdf.setFillColor(r, g, b);
  pdf.setGState(new pdf.GState({ opacity: 0.10 }));
  pdf.roundedRect(cx - 35, badgeY - 8, 70, 16, 3, 3, 'F');
  pdf.setGState(new pdf.GState({ opacity: 1 }));
  pdf.setFont(font, 'bold');
  pdf.setFontSize(13);
  pdf.setTextColor(brandHex);
  pdf.text(`Version ${doc.version}`, cx, badgeY + 2, { align: 'center' });
  pdf.setTextColor('#000000');

  // Standard / type
  pdf.setFont(font, 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor('#6B6960');
  pdf.text(`${doc.type}  ·  ${doc.standard}`, cx, badgeY + 18, { align: 'center' });

  // Status + dates near bottom (each optional)
  pdf.setFontSize(9);
  let infoY = height - 40;
  if (showStatus) { pdf.text(`Status: ${doc.status}`, cx, infoY, { align: 'center' }); infoY += 7; }
  if (showDates)  { pdf.text(`Version date: ${doc.version_date || '—'}`, cx, infoY, { align: 'center' }); infoY += 7; }
  if (showOwner)  { pdf.text(`Owner: ${doc.owner || '—'}`, cx, infoY, { align: 'center' }); infoY += 7; }

  // Footer brand line
  pdf.setDrawColor(224, 221, 212);
  pdf.line(20, height - 16, width - 20, height - 16);
  pdf.setFont(font, 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor('#9B9890');
  const footerText = settings.cover_footer_text?.trim() || `${companyName} · QMS DocControl · ISO 9001 & ISO 27001`;
  pdf.text(footerText, cx, height - 10, { align: 'center' });
  pdf.setTextColor('#000000');
}

// ─────────────────────────────────────────────────────────────────────────────
// VERSION HISTORY PAGE — table with Version, Date, Description, Created by, Approved by
// ─────────────────────────────────────────────────────────────────────────────
function addVersionHistoryPage(pdf, doc, history = [], settings = {}) {
  pdf.addPage();
  const headerTitle = settings.history_header_title?.trim() || `${doc.id} — Version History`;
  addPageHeader(pdf, headerTitle, doc.title, settings);

  const [r,g,b] = hexToRgb(settings.cover_brand_color);
  const font = ['helvetica','times','courier'].includes(settings.history_font) ? settings.history_font : 'helvetica';
  const tableStyle = ['striped','grid','plain'].includes(settings.history_table_style) ? settings.history_table_style : 'striped';
  const showCreatedBy  = settings.history_show_created_by !== 'false';
  const showApprovedBy = settings.history_show_approved_by !== 'false';
  const introText = settings.history_intro_text?.trim();

  // Exclude workflow-status entries (submission/approval/rejection) — these
  // record workflow events, not document version changes, and shouldn't
  // appear in the change log.
  const filteredHistory = filterVersionHistory(history);

  let startY = 20;
  if (introText) {
    pdf.setFont(font, 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor('#4B4A46');
    const introLines = pdf.splitTextToSize(introText, pdf.internal.pageSize.width - 28);
    pdf.text(introLines, 14, startY);
    pdf.setTextColor('#000000');
    startY += introLines.length * 5 + 4;
  }

  // Build header/body based on column visibility
  const headRow = ['Version', 'Version Date', 'Description of Changes'];
  if (showCreatedBy)  headRow.push('Created By');
  if (showApprovedBy) headRow.push('Approved By');

  const placeholderRow = ['—', '—', 'No version history recorded'];
  if (showCreatedBy)  placeholderRow.push('—');
  if (showApprovedBy) placeholderRow.push('—');

  const rows = filteredHistory.length
    ? filteredHistory.map(h => {
        const row = [`v${h.version}`, h.changed_at ? h.changed_at.slice(0, 16).replace('T', ' ') : '—', h.change_note || '—'];
        if (showCreatedBy)  row.push(h.author || '—');
        if (showApprovedBy) row.push(h.approved_by || '—');
        return row;
      })
    : [placeholderRow];

  // Column width map (indices shift based on visible columns). Widths are
  // chosen so each header label fits on a single line at this font size —
  // measured directly against jsPDF's text-width calculation rather than
  // guessed, since a too-narrow column wraps the header (e.g. "Version"
  // breaking into "Versio"/"n").
  const columnStyles = { 0: { cellWidth: 20 }, 1: { cellWidth: 28 }, 2: { cellWidth: 'auto' } };
  let nextCol = 3;
  if (showCreatedBy)  { columnStyles[nextCol] = { cellWidth: 32 }; nextCol++; }
  if (showApprovedBy) { columnStyles[nextCol] = { cellWidth: 32 }; nextCol++; }

  // Table style variants
  const tableOpts = {
    startY,
    head: [headRow],
    body: rows,
    styles: { fontSize: 8.5, cellPadding: 4, valign: 'top', font },
    headStyles: { fillColor: [r, g, b], textColor: 255, fontSize: 8.5, font },
    margin: { left: 14, right: 14 },
    columnStyles,
  };

  if (tableStyle === 'striped') {
    tableOpts.alternateRowStyles = { fillColor: [Math.min(r+200,255), Math.min(g+200,255), Math.min(b+200,255)] };
  } else if (tableStyle === 'grid') {
    tableOpts.theme = 'grid';
    tableOpts.styles.lineWidth = 0.2;
    tableOpts.styles.lineColor = [200, 200, 200];
  } else {
    // plain — no zebra striping, minimal borders
    tableOpts.theme = 'plain';
    tableOpts.styles.lineWidth = 0;
  }

  pdf.autoTable(tableOpts);

  const footerText = settings.history_footer_text?.trim() || `${doc.id} — Version History`;
  addPageFooter(pdf, footerText);
}

// ─────────────────────────────────────────────────────────────────────────────
// Renders paginated plain-text content as one or more pages, with the given
// header title repeated on each page (with "(continued)" suffix on overflow
// pages). Used for the primary document's Word content AND for additional
// supporting-document / evidence attachment content.
// ─────────────────────────────────────────────────────────────────────────────
// Builds the small right-aligned subtitle shown in the page header/banner
// for content pages — "v1.0 · Approved" for a document, just "Approved &
// Closed" for a CAPA record (which has no version concept at all). Centralized
// here since addContentPages/addHtmlContentPages/addPdfMergeBannerPage are
// shared between both document and CAPA PDF export.
function contentPageSubtitle(record) {
  return record.version ? `v${record.version} · ${record.status}` : record.status;
}

function addContentPages(pdf, doc, headerTitle, text, settings = {}) {
  if (!text || !text.trim()) return;

  const { width } = pdf.internal.pageSize;
  pdf.addPage();
  addPageHeader(pdf, headerTitle, contentPageSubtitle(doc), settings);

  const pageH    = pdf.internal.pageSize.height;
  const margin   = 14;
  const lineH    = 5;
  const maxWidth = width - margin * 2;
  let y          = 22;
  let isFirstPage = true;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor('#1C1B18');

  const paragraphs = text.split(/\n+/).filter(p => p.trim());
  for (const para of paragraphs) {
    const lines = pdf.splitTextToSize(para.trim(), maxWidth);
    if (y + lines.length * lineH > pageH - 16) {
      addPageFooter(pdf, isFirstPage ? headerTitle : `${headerTitle} (continued)`);
      pdf.addPage();
      isFirstPage = false;
      addPageHeader(pdf, `${headerTitle} (continued)`, contentPageSubtitle(doc), settings);
      y = 22;
    }
    pdf.text(lines, margin, y);
    y += lines.length * lineH + 3;
  }

  addPageFooter(pdf, isFirstPage ? headerTitle : `${headerTitle} (continued)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Styled-run text layout engine.
//
// jsPDF has no native "rich text" drawing primitive — every call to
// setFont/setFontSize/setTextColor changes state for ALL subsequent text(),
// so mixed formatting within a single paragraph (e.g. "Hello **world**")
// has to be laid out manually: split into word-level tokens carrying their
// own style, measure each with the right font/size/weight applied, wrap
// them into lines that fit maxWidth, then draw each token at its own
// x-position with its own formatting applied just before drawing it.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_RUN_SIZE_PT = 10;

function fontStyleFor(run) {
  if (run.bold && run.italic) return 'bolditalic';
  if (run.bold) return 'bold';
  if (run.italic) return 'italic';
  return 'normal';
}

// Break a paragraph's runs into word-level tokens (preserving the
// trailing space that separates words so wrapping can happen between
// tokens regardless of which original run they came from), each carrying
// its own resolved font/size/style/color/background/underline.
function tokenizeRuns(runs) {
  const tokens = [];
  for (const run of runs) {
    const font = pdfFontFor(run.font);
    const sizePt = run.sizePt || DEFAULT_RUN_SIZE_PT;
    const style = fontStyleFor(run);
    const color = cssColorToRgb(run.color, null);
    const background = cssColorToRgb(run.background, null);
    const underline = !!run.underline;
    const strike = !!run.strike;

    // Preserve explicit newlines (from <br>) as hard line breaks
    const segments = run.text.split('\n');
    segments.forEach((seg, i) => {
      if (i > 0) tokens.push({ text: '\n', isBreak: true });
      // Split on spaces but keep them attached to the preceding word so
      // wrapping logic can measure/advance one token at a time
      const words = seg.match(/\S+\s*|\s+/g) || [];
      for (const w of words) {
        if (!w) continue;
        tokens.push({ text: w, font, sizePt, style, color, background, underline, strike });
      }
    });
  }
  return tokens;
}

// Wrap tokens into lines that fit maxWidth, measuring each token with its
// own font/size/style applied. Returns an array of lines, each an array of
// { text, font, sizePt, style, color, background, underline, strike, width }.
function wrapTokensToLines(pdf, tokens, maxWidth) {
  const lines = [];
  let current = [];
  let currentWidth = 0;

  function pushLine() {
    // Trim trailing whitespace-only token from the line for cleaner wrapping
    while (current.length && /^\s+$/.test(current[current.length - 1].text)) {
      currentWidth -= current[current.length - 1].width;
      current.pop();
    }
    lines.push(current);
    current = [];
    currentWidth = 0;
  }

  for (const tok of tokens) {
    if (tok.isBreak) { pushLine(); continue; }
    pdf.setFont(tok.font, tok.style);
    pdf.setFontSize(tok.sizePt);
    const width = pdf.getTextWidth(tok.text);
    const measured = { ...tok, width };

    if (currentWidth + width > maxWidth && current.length > 0) {
      pushLine();
    }
    current.push(measured);
    currentWidth += width;
  }
  if (current.length) pushLine();
  if (!lines.length) lines.push([]);
  return lines;
}

// Draw one wrapped line at the given baseline y, honoring per-token
// font/size/color/background/underline/strikethrough, and the paragraph's
// alignment. Returns the line's height (tallest token's size-based line
// height) so the caller can advance y correctly.
function drawRunLine(pdf, line, margin, maxWidth, y, align) {
  if (!line.length) return DEFAULT_RUN_SIZE_PT * 0.352778 * 1.3;

  const lineWidth = line.reduce((sum, t) => sum + t.width, 0);
  let x = margin;
  if (align === 'center') x = margin + (maxWidth - lineWidth) / 2;
  else if (align === 'right') x = margin + (maxWidth - lineWidth);

  const maxSizePt = Math.max(...line.map(t => t.sizePt));
  const lineHeightMm = maxSizePt * 0.352778 * 1.3; // pt -> mm, with standard line-height multiplier

  for (const tok of line) {
    if (!tok.text.trim()) { x += tok.width; continue; }

    if (tok.background) {
      pdf.setFillColor(tok.background[0], tok.background[1], tok.background[2]);
      const sizeMm = tok.sizePt * 0.352778;
      pdf.rect(x, y - sizeMm * 0.8, tok.width, sizeMm * 1.05, 'F');
    }

    pdf.setFont(tok.font, tok.style);
    pdf.setFontSize(tok.sizePt);
    pdf.setTextColor(tok.color ? tok.color[0] : 28, tok.color ? tok.color[1] : 27, tok.color ? tok.color[2] : 24);
    pdf.text(tok.text, x, y);

    if (tok.underline || tok.strike) {
      const sizeMm = tok.sizePt * 0.352778;
      const lineY = tok.underline ? y + sizeMm * 0.12 : y - sizeMm * 0.3;
      pdf.setDrawColor(tok.color ? tok.color[0] : 28, tok.color ? tok.color[1] : 27, tok.color ? tok.color[2] : 24);
      pdf.setLineWidth(0.15);
      pdf.line(x, lineY, x + tok.width, lineY);
    }

    x += tok.width;
  }
  pdf.setTextColor('#1C1B18');
  return lineHeightMm;
}

// Renders one paragraph block (runs + alignment) starting at the given y,
// paginating via the supplied newPage() callback when a line would run
// past the footer zone. Returns the new y position after the paragraph.
function drawRichParagraph(pdf, block, margin, maxWidth, y, pageH, newPage) {
  const runs = block.headerLevel
    ? block.runs.map(r => ({ ...r, bold: true, sizePt: r.sizePt || [0, 18, 15, 13][block.headerLevel] || DEFAULT_RUN_SIZE_PT }))
    : block.runs;
  const tokens = tokenizeRuns(runs);
  const lines = wrapTokensToLines(pdf, tokens, maxWidth);

  for (const line of lines) {
    const maxSizePt = line.length ? Math.max(...line.map(t => t.sizePt)) : DEFAULT_RUN_SIZE_PT;
    const lineHeightMm = maxSizePt * 0.352778 * 1.3;
    if (y + lineHeightMm > pageH - 16) {
      y = newPage();
    }
    drawRunLine(pdf, line, margin, maxWidth, y, block.align);
    y += lineHeightMm;
  }
  return y + 3; // paragraph spacing
}

// ─────────────────────────────────────────────────────────────────────────────
// Renders rich-text HTML content (from the Scope field or a created document
// attachment) as one or more pages, preserving any tables exactly as real
// PDF tables (via autoTable) instead of flattening them to broken text.
// Text blocks wrap and paginate the same way addContentPages() does; table
// blocks are drawn with autoTable and the cursor continues below them.
// ─────────────────────────────────────────────────────────────────────────────
// Draws an image block (from a pasted/inserted image in the editor) at the
// given y, scaling it to fit within maxWidth while preserving its aspect
// ratio, and capping the display height so one large image can't consume
// most of a page. Paginates via newPage() if the image won't fit on the
// remaining space of the current page. Returns the new y position.
// Malformed/unsupported image data is skipped with a small inline note
// rather than throwing and aborting the whole PDF export.
function drawImageBlock(pdf, block, margin, maxWidth, y, pageH, newPage) {
  const MAX_DISPLAY_HEIGHT_MM = 150;
  let props;
  try {
    props = pdf.getImageProperties(block.src);
  } catch (err) {
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(9); pdf.setTextColor('#9B9890');
    if (y + 6 > pageH - 16) y = newPage();
    pdf.text('[Image could not be embedded in this PDF]', margin, y);
    pdf.setTextColor('#1C1B18');
    return y + 8;
  }

  const aspect = props.height / props.width;
  let dispWidth = Math.min(maxWidth, 140);
  let dispHeight = dispWidth * aspect;
  if (dispHeight > MAX_DISPLAY_HEIGHT_MM) {
    dispHeight = MAX_DISPLAY_HEIGHT_MM;
    dispWidth = dispHeight / aspect;
  }

  // If the image is taller than a full content area, it'll never fit on one
  // page regardless — start it fresh on its own page rather than splitting.
  const availableOnThisPage = (pageH - 16) - y;
  if (dispHeight > availableOnThisPage && dispHeight <= (pageH - 16) - 22) {
    y = newPage();
  }

  try {
    pdf.addImage(block.src, props.fileType || 'PNG', margin, y, dispWidth, dispHeight);
  } catch (err) {
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(9); pdf.setTextColor('#9B9890');
    pdf.text('[Image could not be embedded in this PDF]', margin, y);
    pdf.setTextColor('#1C1B18');
    return y + 8;
  }
  return y + dispHeight + 6;
}

function addHtmlContentPages(pdf, doc, headerTitle, html, settings = {}) {
  const blocks = htmlToRichBlocks(html);
  if (!blocks.length) return;

  const { width } = pdf.internal.pageSize;
  const pageH    = pdf.internal.pageSize.height;
  const margin   = 14;
  const maxWidth = width - margin * 2;

  pdf.addPage();
  addPageHeader(pdf, headerTitle, contentPageSubtitle(doc), settings);
  let y = 22;
  let isFirstPage = true;

  function newPage() {
    addPageFooter(pdf, isFirstPage ? headerTitle : `${headerTitle} (continued)`);
    pdf.addPage();
    isFirstPage = false;
    addPageHeader(pdf, `${headerTitle} (continued)`, contentPageSubtitle(doc), settings);
    y = 22;
    return y;
  }

  for (const block of blocks) {
    if (block.type === 'table') {
      // autoTable handles its own pagination if the table runs past the
      // bottom margin, but we still need a fresh page if there isn't even
      // room to start the table header without it looking cramped.
      if (y > pageH - 40) newPage();
      pdf.autoTable({
        startY: y,
        body: block.rows,
        styles: { fontSize: 9, cellPadding: 4, valign: 'top' },
        theme: 'grid',
        margin: { left: margin, right: margin },
        tableWidth: maxWidth,
      });
      y = pdf.lastAutoTable.finalY + 6;
    } else if (block.type === 'image') {
      y = drawImageBlock(pdf, block, margin, maxWidth, y, pageH, newPage);
    } else {
      y = drawRichParagraph(pdf, block, margin, maxWidth, y, pageH, newPage);
    }
  }

  addPageFooter(pdf, isFirstPage ? headerTitle : `${headerTitle} (continued)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. INDIVIDUAL DOCUMENT PDF
//    Page 1: Cover (branded)
//    Page 2: Metadata + scope
//    Page 3+: Primary document content (if available)
//    Next:    Supporting document / evidence attachment content (if any)
//    Last page: Version history table
// ─────────────────────────────────────────────────────────────────────────────
// Draws a short banner page announcing that the original pages of an
// uploaded PDF follow immediately after. This page itself is drawn through
// the normal jsPDF flow (so it gets the same header/footer/watermark as
// everything else); the actual uploaded PDF pages get merged in right after
// it as a separate post-processing step (see mergeUploadedPdfs below),
// since jsPDF itself cannot import pages from an existing PDF file.
function addPdfMergeBannerPage(pdf, doc, headerTitle, filename, settings = {}) {
  pdf.addPage();
  addPageHeader(pdf, headerTitle, contentPageSubtitle(doc), settings);
  const { width, height } = pdf.internal.pageSize;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor('#4B4A46');
  const lines = pdf.splitTextToSize(`The original pages of "${filename}" follow this page, exactly as uploaded.`, width - 28);
  pdf.text(lines, 14, 30);
  pdf.setTextColor('#000000');
  addPageFooter(pdf, headerTitle);
}

// ── Merges uploaded PDF pages into a generated document PDF ──────────────────
// Called after exportSingleDocumentPDF() returns a { needsMerge: true, ... }
// result. jsPDF cannot import pages from an existing PDF file, so this uses
// pdf-lib (a separate library that operates on raw PDF bytes) to:
//   1. Load the jsPDF-generated bytes as a pdf-lib document
//   2. For each merge insertion point, fetch the uploaded file's bytes and
//      copy its pages in, right after the banner page that announces it
//   3. Re-apply the watermark and "Page X of Y" footer to the FINAL combined
//      page set, replicating jsPDF's exact visual parameters (font, size,
//      color, opacity, rotation, position) using pdf-lib's own drawing API —
//      this can't be done by calling the original jsPDF functions, since by
//      this point we're working with a different library's page objects.
// `fetchBytes` is an async (fileId) => ArrayBuffer function — injected so
// this module doesn't need to import the API client directly.
export async function mergeUploadedPdfsIntoPdf(buildResult, fetchBytes) {
  const { pdfBytes, mergeInsertions, filename, watermarkText, watermarkColor } = buildResult;

  const mainDoc = await PDFDocument.load(pdfBytes);

  // Insert in REVERSE order of position so earlier insertions don't shift
  // the page indices of later ones still to be processed.
  const sorted = [...mergeInsertions].sort((a, b) => b.afterPage - a.afterPage);
  const failedMerges = [];

  for (const ins of sorted) {
    try {
      const uploadedBytes = await fetchBytes(ins.fileId);
      const uploadedDoc = await PDFDocument.load(uploadedBytes);
      const copiedPages = await mainDoc.copyPages(uploadedDoc, uploadedDoc.getPageIndices());
      // afterPage is 1-indexed (matches jsPDF's getNumberOfPages()); pdf-lib's
      // insertPage() takes a 0-indexed position, and inserting AFTER page N
      // (1-indexed) means inserting AT index N (0-indexed) — e.g. after
      // page 3 means at index 3, which is between current pages 3 and 4.
      copiedPages.forEach((page, i) => {
        mainDoc.insertPage(ins.afterPage + i, page);
      });
    } catch (err) {
      // Encrypted, corrupted, or otherwise unreadable uploaded PDF — skip
      // merging it (the banner page explaining what should follow stays in
      // place) rather than failing the entire export. Reported back to the
      // caller so it can tell the person which file(s) couldn't be merged.
      failedMerges.push({ filename: ins.filename, reason: err.message });
    }
  }

  // ── Re-apply watermark + page numbers to the FINAL combined page set ──────
  const font = await mainDoc.embedFont(StandardFonts.HelveticaBold);
  const fontNormal = await mainDoc.embedFont(StandardFonts.Helvetica);
  const [wr, wg, wb] = hexToRgb(watermarkColor).map(c => c / 255);
  const MM_TO_PT = 72 / 25.4;
  const total = mainDoc.getPageCount();

  mainDoc.getPages().forEach((page, idx) => {
    const { width, height } = page.getSize();
    const cx = width / 2;
    const cy = height / 2;
    const textWidth = font.widthOfTextAtSize(watermarkText, 44);

    // Watermark — same 3x3 repeating diagonal pattern as stampWatermark(),
    // with row/col offsets converted from jsPDF's mm units to pdf-lib's
    // points (1mm = 2.834645669291339pt), and Y flipped since jsPDF
    // measures from the top of the page while PDF coordinates measure from
    // the bottom.
    [-1, 0, 1].forEach(row => {
      [-1, 0, 1].forEach(col => {
        // Same center-point + repeating-offset pattern as jsPDF's
        // stampWatermark(), computed directly in points — cx/cy are already
        // in points (from page.getSize()); only the 140/100 offset
        // constants need converting, since those were written in mm to
        // match jsPDF's mm-based coordinate system.
        const targetX = cx + col * 140 * MM_TO_PT;
        const targetY = cy + row * 100 * MM_TO_PT; // jsPDF's "from top" Y, not yet flipped
        // jsPDF's `align: 'center'` with a rotation angle centers text by
        // offsetting the start point backward along the rotation direction
        // by half the text width before drawing — replicated manually here
        // since pdf-lib has no text-align option.
        const angleRad = Math.PI / 4; // 45 degrees, matches stampWatermark()
        const halfWidthPt = textWidth / 2;
        const startX = targetX - halfWidthPt * Math.cos(angleRad);
        const startY = (height - targetY) - halfWidthPt * Math.sin(angleRad); // flip Y: PDF measures from bottom
        page.drawText(watermarkText, {
          x: startX, y: startY, size: 44, font,
          color: rgb(wr, wg, wb), opacity: 0.10, rotate: degrees(45),
        });
      });
    });

    // Footer — "Page X of Y" centered, matching finalizePageNumbers(), which
    // draws at jsPDF y = height-6 (mm, Y-from-top) — i.e. the text baseline
    // sits 6mm above the bottom edge. In PDF-native coordinates (Y measured
    // from the bottom), that's simply Y = 6mm converted to points.
    const pageLabel = `Page ${idx + 1} of ${total}`;
    const labelWidth = fontNormal.widthOfTextAtSize(pageLabel, 8);
    page.drawText(pageLabel, {
      x: cx - labelWidth / 2, y: 6 * MM_TO_PT, size: 8, font: fontNormal,
      color: rgb(0x6B/255, 0x69/255, 0x60/255),
    });
  });

  const finalBytes = await mainDoc.save();
  return { bytes: finalBytes, filename, failedMerges };
}

// Triggers a browser download of the given bytes — used by the async merge
// path since pdf-lib's output is raw bytes, not a jsPDF instance with its
// own .save() method.
export function downloadPdfBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function exportSingleDocumentPDF(doc, files = [], isArchived = false, wordText = null, history = [], settings = {}, attachments = [], wordHtml = null, mergePdfs = []) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const { width } = pdf.internal.pageSize;

  let watermarkText, watermarkColor;
  if (isArchived) {
    watermarkText = 'OBSOLETE VERSION'; watermarkColor = '#CC0000';
  } else if (doc.status === 'Approved') {
    watermarkText = 'UNCONTROLLED COPY'; watermarkColor = '#1A56DB';
  } else {
    watermarkText = 'DRAFT — NOT FOR USE'; watermarkColor = '#F0AD4E';
  }

  // ── Page 1: Cover page ───────────────────────────────────────────────────
  addCoverPage(pdf, doc, settings);

  // ── Page 2: Metadata / scope ─────────────────────────────────────────────
  pdf.addPage();
  addPageHeader(pdf, 'QMS DocControl', 'ISO 9001 & ISO 27001', settings);

  pdf.setFillColor(245, 244, 239);
  pdf.rect(14, 18, width - 28, 28, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.setTextColor('#1C1B18');
  const titleLines = pdf.splitTextToSize(doc.title, width - 36);
  pdf.text(titleLines, 20, 27);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor('#6B6960');
  pdf.text(`${doc.id}   ·   Version ${doc.version}   ·   ${doc.standard}`, 20, 27 + titleLines.length * 7);

  pdf.autoTable({
    startY: 52,
    head: [],
    body: [
      ['Document ID', doc.id,                  'Type',            doc.type],
      ['Standard',    doc.standard,            'Clause / Control', doc.clause || '—'],
      ['Version',     `v${doc.version}`,       'Version Date',    doc.version_date || '—'],
      ['Status',      doc.status,              'Owner',           doc.owner || '—'],
      ['Next Review', doc.review_date || '—',  'Created',         doc.created_at ? doc.created_at.slice(0,10) : '—'],
    ],
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: {
      0: { fontStyle:'bold', fillColor:[240,246,255], cellWidth:38 },
      2: { fontStyle:'bold', fillColor:[240,246,255], cellWidth:38 },
    },
    margin: { left: 14, right: 14 },
    tableLineColor: [224, 221, 212], tableLineWidth: 0.3,
  });

  const afterMeta = pdf.lastAutoTable.finalY + 8;

  // If Scope contains a table OR the styled content is long enough that it
  // would run into the footer (and potentially into the Evidence/Primary
  // Document/Supporting Attachments sections that follow it on this same
  // fixed-layout page), keep page 2 simple: a short pointer note here, with
  // the full content rendered on its own dedicated page(s) right after —
  // exactly the same pattern already used for tables, just extended to long
  // text. Short scope still renders inline, but now via the same styled-run
  // renderer used on the dedicated page, so font/size/bold/color/highlight
  // choices made in the editor show up here too, not just on overflow pages.
  const scopeHasTable = /<table[\s>]/i.test(doc.scope || '');
  const scopeHasImage = /<img[\s>]/i.test(doc.scope || '');
  const scopeAllBlocks = htmlToRichBlocks(doc.scope);
  const scopeRichBlocks = scopeAllBlocks.filter(b => b.type === 'paragraph');
  const scopePlainText = htmlToPlainText(doc.scope);

  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor('#1C1B18');
  pdf.text('Scope / Description', 14, afterMeta);

  // Footer sits at pageH-6; reserve extra room below the scope text for
  // whatever sections render after it on this page (Linked Evidence,
  // Primary Document, Supporting Attachments) before deciding it's safe
  // to render scope inline rather than on a dedicated continuation page.
  const pageH = pdf.internal.pageSize.height;
  const trailingSectionsBudget = 14
    + (doc.evidence && doc.evidence.length ? 16 + doc.evidence.length * 5.5 : 0)
    + (files.find(f => f.is_primary === 1) ? 22 : 0)
    + (files.filter(f => f.is_primary !== 1).length ? 16 + files.filter(f => f.is_primary !== 1).length * 5.5 : 0);
  const scopeMaxWidth = width - 28;

  // Measure the styled content's height the same way it'll actually be
  // drawn (same tokenizer/wrapper as the dedicated-page renderer), so the
  // inline-vs-dedicated-page decision matches what will really fit.
  let measuredScopeHeight = 0;
  for (const block of scopeRichBlocks) {
    const tokens = tokenizeRuns(block.runs);
    const lines = wrapTokensToLines(pdf, tokens, scopeMaxWidth);
    for (const line of lines) {
      const maxSizePt = line.length ? Math.max(...line.map(t => t.sizePt)) : DEFAULT_RUN_SIZE_PT;
      measuredScopeHeight += maxSizePt * 0.352778 * 1.3;
    }
    measuredScopeHeight += 3; // paragraph spacing, matching drawRichParagraph
  }
  const scopeFitsInline = !scopeHasTable && !scopeHasImage && scopeRichBlocks.length > 0 &&
    (afterMeta + 6 + measuredScopeHeight + trailingSectionsBudget) <= (pageH - 16);

  let afterScope;
  if (scopeHasTable) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor('#4B4A46');
    const lines = pdf.splitTextToSize('This scope includes a table — see the "Scope / Description" page following this one for the full content.', scopeMaxWidth);
    pdf.text(lines, 14, afterMeta + 6);
    afterScope = afterMeta + 8 + lines.length * 5;
  } else if (scopeHasImage) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor('#4B4A46');
    const lines = pdf.splitTextToSize('This scope includes an image — see the "Scope / Description" page following this one for the full content.', scopeMaxWidth);
    pdf.text(lines, 14, afterMeta + 6);
    afterScope = afterMeta + 8 + lines.length * 5;
  } else if (!scopeFitsInline) {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor('#4B4A46');
    const noteText = scopeAllBlocks.length > 0
      ? 'This description is long — see the "Scope / Description" page following this one for the full content.'
      : 'No description provided.';
    const lines = pdf.splitTextToSize(noteText, scopeMaxWidth);
    pdf.text(lines, 14, afterMeta + 6);
    afterScope = afterMeta + 8 + lines.length * 5;
  } else {
    let y = afterMeta + 6;
    for (const block of scopeRichBlocks) {
      const tokens = tokenizeRuns(block.runs);
      const lines = wrapTokensToLines(pdf, tokens, scopeMaxWidth);
      for (const line of lines) {
        const lineHeightMm = drawRunLine(pdf, line, 14, scopeMaxWidth, y, block.align);
        y += lineHeightMm;
      }
      y += 3;
    }
    afterScope = y + 2;
  }

  if (doc.evidence && doc.evidence.length) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor('#1C1B18');
    pdf.text('Linked Evidence', 14, afterScope);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor('#4B4A46');
    doc.evidence.forEach((e, i) => pdf.text(`• ${e}`, 16, afterScope + 6 + i * 5.5));
  }

  const supportingFiles = files.filter(f => f.is_primary !== 1);
  const primaryFile = files.find(f => f.is_primary === 1);
  const afterEv = afterScope + 10 + (doc.evidence?.length || 0) * 5.5;

  if (primaryFile) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor('#1C1B18');
    pdf.text('Primary Document', 14, afterEv);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor('#4B4A46');
    pdf.text(`📄 ${primaryFile.originalname}   (see following page)`, 14, afterEv + 6);
  }

  if (supportingFiles.length) {
    const y = afterEv + (primaryFile ? 16 : 0);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor('#1C1B18');
    pdf.text('Supporting Attachments', 14, y);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor('#4B4A46');
    const attachmentTitles = new Set((attachments || []).map(a => a.title));
    supportingFiles.forEach((f, i) => {
      const tag = f.file_category === 'evidence' ? '📎 [Evidence] ' : '📎 ';
      const hasContent = attachmentTitles.has(f.originalname);
      const sizeLabel = f.mimetype === 'application/x-qms-document' ? 'Created document' : `${((f.size||0)/1024).toFixed(1)} KB`;
      const suffix = hasContent ? '   (content included below)' : `   (${sizeLabel})`;
      pdf.text(`${tag}${f.originalname}${suffix}`, 14, y + 6 + i * 5.5);
    });
  }

  addPageFooter(pdf, `${doc.id} — ${doc.title} — This document is for reference only`);

  // ── If Scope contains a table or image, or was too long to render inline
  // above, give it a dedicated page (or pages — addContentPages/
  // addHtmlContentPages both paginate automatically) right after the
  // metadata page. Table/image content must go through the rich HTML
  // renderer (addHtmlContentPages) since the plain-text renderer would
  // strip them entirely — long-but-plain text can use the simpler one. ────
  if (scopeHasTable || scopeHasImage) {
    addHtmlContentPages(pdf, doc, `${doc.id} — Scope / Description`, doc.scope, settings);
  } else if (!scopeFitsInline) {
    addContentPages(pdf, doc, `${doc.id} — Scope / Description`, scopePlainText, settings);
  }

  // ── Page 3+: Primary document content (if available) ─────────────────────
  // Prefer rich HTML (headings/bold/lists/tables preserved) when the source
  // was a .docx that could be converted; fall back to plain text for legacy
  // .doc files or any case where only plain text was extracted.
  const mergeInsertions = []; // [{ afterPage, fileId, filename }] — filled in below, consumed by mergeUploadedPdfs()
  const primaryMerge = (mergePdfs || []).find(m => m.role === 'primary');
  if (primaryMerge) {
    addPdfMergeBannerPage(pdf, doc, `${doc.id} — Document Content`, primaryMerge.filename, settings);
    mergeInsertions.push({ afterPage: pdf.internal.getNumberOfPages(), fileId: primaryMerge.fileId, filename: primaryMerge.filename });
  } else if (wordHtml && wordHtml.trim()) {
    addHtmlContentPages(pdf, doc, `${doc.id} — Document Content`, wordHtml, settings);
  } else {
    addContentPages(pdf, doc, `${doc.id} — Document Content`, wordText, settings);
  }

  // ── Next: Supporting document / evidence attachment content ──────────────
  // Each attachment with extractable/created content gets its own page(s),
  // appearing after the primary content and before the version history page.
  // Created (rich-text) attachments carry raw HTML so tables render as real
  // PDF tables; plain-text Word attachments are rendered as wrapped text.
  for (const att of (attachments || [])) {
    const categoryLabel = att.category === 'evidence' ? 'Evidence' : 'Supporting Document';
    const headerTitle = `${doc.id} — ${categoryLabel}: ${att.title}`;
    if (att.html && att.html.trim()) {
      addHtmlContentPages(pdf, doc, headerTitle, att.html, settings);
    } else if (att.text && att.text.trim()) {
      addContentPages(pdf, doc, headerTitle, att.text, settings);
    }
  }

  // Uploaded PDF attachments get a banner page + their original pages merged
  // in right after (see mergeUploadedPdfsIntoPdf below). Handled as its own
  // pass, separate from the `attachments` loop above — PDF files never carry
  // extracted html/text content (there's nothing to extract), so they never
  // appear in `attachments` at all and would otherwise never be reached.
  for (const m of (mergePdfs || [])) {
    if (m.role !== 'attachment') continue;
    const categoryLabel = m.category === 'evidence' ? 'Evidence' : 'Supporting Document';
    const headerTitle = `${doc.id} — ${categoryLabel}: ${m.filename}`;
    addPdfMergeBannerPage(pdf, doc, headerTitle, m.filename, settings);
    mergeInsertions.push({ afterPage: pdf.internal.getNumberOfPages(), fileId: m.fileId, filename: m.filename });
  }

  // ── Last page: Version history table ─────────────────────────────────────
  addVersionHistoryPage(pdf, doc, history, settings);

  const filenameStatusLabel = isArchived ? 'Obsolete' : doc.status.replace(/\s+/g, '_');
  const filename = `${doc.id}_v${doc.version}_${filenameStatusLabel}.pdf`;

  if (mergeInsertions.length === 0) {
    // No uploaded PDFs to merge — exact original synchronous behavior.
    stampWatermark(pdf, watermarkText, watermarkColor);
    finalizePageNumbers(pdf);
    pdf.save(filename);
    return;
  }

  // One or more uploaded PDFs need their pages merged in. jsPDF itself can't
  // import pages from an existing PDF, and merging happens via a separate
  // library (pdf-lib) operating on raw bytes after this function returns —
  // so watermarking and page numbers are deliberately NOT applied here.
  // They're applied once, after merging, to the FINAL combined page set (see
  // mergeUploadedPdfsIntoPdf below) so numbering is correct across the whole
  // document and merged-in pages get the same watermark as everything else.
  return {
    needsMerge: true,
    pdfBytes: pdf.output('arraybuffer'),
    mergeInsertions,
    filename,
    watermarkText,
    watermarkColor,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. FULL REGISTER PDF
// ─────────────────────────────────────────────────────────────────────────────
export function exportDocumentsPDF(data, settings = {}) {
  const { documents, capas, history, generated } = data;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const { width } = pdf.internal.pageSize;

  addPageHeader(pdf, 'QMS Document Register', `ISO 9001 & ISO 27001  ·  ${generated}  ·  ${documents.length} documents`, settings);

  const [hr,hg,hb] = hexToRgb(settings.cover_brand_color);

  pdf.autoTable({
    startY: 18,
    head: [['ID', 'Title', 'Type', 'Standard', 'Version', 'Version Date & Time', 'Status', 'Owner', 'Next Review']],
    body: documents.map(d => [
      d.id, d.title, d.type, d.standard,
      `v${d.version}`,
      d.version_date || '—',
      d.status,
      d.owner || '—',
      d.review_date || '—',
    ]),
    styles:          { fontSize: 7.5 },
    headStyles:      { fillColor: [hr,hg,hb], textColor: 255, fontSize: 7.5 },
    alternateRowStyles: { fillColor: [Math.min(hr+200,255), Math.min(hg+200,255), Math.min(hb+200,255)] },
    margin:          { left: 14, right: 14 },
    columnStyles:    { 1: { cellWidth: 55 } },
  });
  addPageFooter(pdf, 'QMS DocControl — Full Document Register');

  pdf.addPage();
  addPageHeader(pdf, 'NCR / CAPA Register', `${capas.length} records`, settings);

  pdf.autoTable({
    startY: 18,
    head: [['ID', 'Type', 'Title', 'Clause', 'Status', 'Owner', 'Due Date', '% Complete']],
    body: capas.map(c => [
      c.id, c.type, c.title, c.clause || '—',
      c.status, c.owner || '—', c.due_date || '—', `${c.pct_complete}%`
    ]),
    styles:          { fontSize: 7.5 },
    headStyles:      { fillColor: [163, 45, 45], textColor: 255, fontSize: 7.5 },
    alternateRowStyles: { fillColor: [255, 240, 240] },
    margin:          { left: 14, right: 14 },
    columnStyles:    { 2: { cellWidth: 65 } },
  });
  addPageFooter(pdf, 'QMS DocControl — NCR/CAPA Register');

  pdf.addPage();
  const filteredFullHistory = filterVersionHistory(history);
  addPageHeader(pdf, 'Version History', `${filteredFullHistory.length} entries`, settings);

  pdf.autoTable({
    startY: 18,
    head: [['Doc ID', 'Version', 'Changed At', 'Author', 'Approved By', 'Change Note']],
    body: filteredFullHistory.map(h => [h.doc_id, h.version, h.changed_at, h.author || '—', h.approved_by || '—', h.change_note || '—']),
    styles:          { fontSize: 7.5 },
    headStyles:      { fillColor: [59, 109, 17], textColor: 255, fontSize: 7.5 },
    alternateRowStyles: { fillColor: [240, 250, 235] },
    margin:          { left: 14, right: 14 },
    columnStyles:    { 5: { cellWidth: 90 } },
  });
  addPageFooter(pdf, 'QMS DocControl — Version History');

  stampWatermark(pdf, 'UNCONTROLLED COPY', '#1A56DB');
  finalizePageNumbers(pdf);

  pdf.save('QMS_DocControl_Full_Register.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ARCHIVED VERSION PDF
// ─────────────────────────────────────────────────────────────────────────────
export function exportArchivedVersionPDF(doc, history = [], settings = {}) {
  exportSingleDocumentPDF(doc, [], true, null, history, settings);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. NCR/CAPA RECORD PDF — only ever generated for Approved & Closed records
//    (the locked, final state), so this is a permanent audit artifact, not a
//    draft/working copy. Reuses the same rich-content and PDF-merge machinery
//    built for documents above.
//    Page 1: Cover (record ID, title, type, status)
//    Page 2: Metadata + Nonconformity Detail / Root Cause / Corrective Action
//    Next:   Evidence (created docs rendered inline; uploaded PDFs merged in)
//    Last:   Approval History table
// ─────────────────────────────────────────────────────────────────────────────

// Cover page for a CAPA record — same branding treatment as the document
// cover page, but without document-only concepts like "Version".
function addCapaCoverPage(pdf, capa, settings = {}) {
  const { width, height } = pdf.internal.pageSize;
  const cx = width / 2;
  const companyName = settings.company_name?.trim() || 'CognifAI';
  const [r,g,b] = hexToRgb(settings.cover_brand_color);
  const brandHex = settings.cover_brand_color?.trim() || '#1A56DB';
  const font = ['helvetica','times','courier'].includes(settings.cover_font) ? settings.cover_font : 'helvetica';

  pdf.setFillColor(r, g, b);
  pdf.rect(0, 0, width, 50, 'F');
  drawCompanyLogo(pdf, cx - 12, 12, 24, settings);
  pdf.setFont(font, 'bold');
  pdf.setFontSize(20);
  pdf.setTextColor('#FFFFFF');
  pdf.text(companyName, cx, 45, { align: 'center' });
  pdf.setTextColor('#000000');

  pdf.setFont(font, 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor('#6B6960');
  pdf.text('NCR / CAPA Record — Official Closed Record', cx, 58, { align: 'center' });
  pdf.setTextColor('#000000');

  pdf.setFont(font, 'bold');
  pdf.setFontSize(22);
  const titleLines = pdf.splitTextToSize(capa.title, width - 60);
  const titleY = Math.max(height * 0.38, 70);
  pdf.text(titleLines, cx, titleY, { align: 'center' });

  pdf.setFont(font, 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor('#6B6960');
  pdf.text(capa.id, cx, titleY + titleLines.length * (22 * 0.42) + 8, { align: 'center' });

  const badgeY = titleY + titleLines.length * (22 * 0.42) + 22;
  pdf.setFillColor(r, g, b);
  pdf.setGState(new pdf.GState({ opacity: 0.10 }));
  pdf.roundedRect(cx - 38, badgeY - 8, 76, 16, 3, 3, 'F');
  pdf.setGState(new pdf.GState({ opacity: 1 }));
  pdf.setFont(font, 'bold');
  pdf.setFontSize(13);
  pdf.setTextColor(brandHex);
  pdf.text(capa.type || 'NCR', cx, badgeY + 2, { align: 'center' });
  pdf.setTextColor('#000000');

  pdf.setFont(font, 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor('#6B6960');
  pdf.text(capa.clause ? `Clause / Control: ${capa.clause}` : ' ', cx, badgeY + 18, { align: 'center' });

  pdf.setFontSize(9);
  let infoY = height - 40;
  pdf.text(`Status: ${capa.status}`, cx, infoY, { align: 'center' }); infoY += 7;
  pdf.text(`Closed: ${capa.closed_at ? String(capa.closed_at).slice(0,10) : '—'}`, cx, infoY, { align: 'center' }); infoY += 7;
  pdf.text(`Owner: ${capa.owner || '—'}`, cx, infoY, { align: 'center' }); infoY += 7;

  pdf.setDrawColor(224, 221, 212);
  pdf.line(20, height - 16, width - 20, height - 16);
  pdf.setFont(font, 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor('#9B9890');
  pdf.text(`${companyName} · QMS DocControl · ISO 9001 & ISO 27001`, cx, height - 10, { align: 'center' });
  pdf.setTextColor('#000000');
}

// Builds a single chronological audit trail from the record's own
// created/updated fields plus every approval workflow attempt. Mirrors the
// same logic used in the Capas.jsx UI (buildAuditTrail there) — duplicated
// here in plain form rather than imported, since utils/pdfExport.js
// shouldn't depend on a page component, and this transformation is simple
// enough that keeping one small copy in each place is the more maintainable
// trade-off than introducing a cross-layer dependency for it.
function buildCapaAuditTrailForPdf(capa, workflowHistory) {
  const entries = [];
  if (capa.created_at) {
    entries.push({ at: capa.created_at, label: 'Created', by: capa.created_by || 'Unknown' });
  }
  if (capa.updated_at && capa.updated_by && capa.updated_at !== capa.created_at) {
    entries.push({ at: capa.updated_at, label: 'Last edited', by: capa.updated_by });
  }
  for (const wf of (workflowHistory || [])) {
    entries.push({ at: wf.created_at, label: 'Submitted for approval', by: wf.submitted_by });
    for (const step of (wf.steps || [])) {
      if (step.status === 'Approved') {
        entries.push({ at: step.acted_at, label: `Approved (step ${step.step_order})`, by: step.approver_name, comment: step.comment });
      } else if (step.status === 'Rejected') {
        entries.push({ at: step.acted_at, label: `Rejected (step ${step.step_order})`, by: step.approver_name, comment: step.comment });
      }
    }
  }
  return entries.filter(e => e.at).sort((a, b) => new Date(a.at) - new Date(b.at));
}

function addCapaApprovalHistoryPage(pdf, capa, workflowHistory, settings = {}) {
  pdf.addPage();
  addPageHeader(pdf, `${capa.id} — Approval History`, capa.title, settings);

  const trail = buildCapaAuditTrailForPdf(capa, workflowHistory);
  const { width } = pdf.internal.pageSize;

  pdf.autoTable({
    startY: 20,
    head: [['Date', 'Event', 'By', 'Comment']],
    body: trail.length > 0
      ? trail.map(e => [
          e.at ? String(e.at).slice(0, 16).replace('T', ' ') : '—',
          e.label,
          e.by || '—',
          e.comment || '—',
        ])
      : [['—', 'No history recorded', '—', '—']],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [240, 246, 255], textColor: [28, 27, 24], fontStyle: 'bold' },
    margin: { left: 14, right: 14 },
    columnStyles: { 0: { cellWidth: 32 }, 1: { cellWidth: 50 }, 2: { cellWidth: 35 } },
    theme: 'striped',
  });

  addPageFooter(pdf, `${capa.id} — Approval History`);
}

// Main entry point — exports a PDF for an Approved & Closed NCR/CAPA record.
// `evidenceAttachments` follows the same shape used for document attachments:
// [{ title, html }] for created (rich-text) evidence, plus `mergePdfs` for
// uploaded PDF evidence files whose actual pages should be merged in
// ([{ fileId, filename, category: 'evidence' }]). Returns undefined and
// triggers an immediate download if there's nothing to merge (the common
// case), or { needsMerge: true, ... } for the caller to pass to
// mergeUploadedPdfsIntoPdf() + downloadPdfBytes(), exactly like
// exportSingleDocumentPDF — see DocumentPreviewModal.jsx's handleDownloadPDF
// for the calling pattern to mirror.
export function exportCapaRecordPDF(capa, workflowHistory = [], settings = {}, evidenceAttachments = [], mergePdfs = []) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const { width } = pdf.internal.pageSize;

  // ── Page 1: Cover ──────────────────────────────────────────────────────
  addCapaCoverPage(pdf, capa, settings);

  // ── Page 2: Metadata + Nonconformity Detail ────────────────────────────
  pdf.addPage();
  addPageHeader(pdf, 'QMS DocControl', 'ISO 9001 & ISO 27001', settings);

  pdf.setFillColor(245, 244, 239);
  pdf.rect(14, 18, width - 28, 28, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.setTextColor('#1C1B18');
  const titleLines = pdf.splitTextToSize(capa.title, width - 36);
  pdf.text(titleLines, 20, 27);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor('#6B6960');
  pdf.text(`${capa.id}   ·   ${capa.type}   ·   ${capa.status}`, 20, 27 + titleLines.length * 7);

  pdf.autoTable({
    startY: 52,
    head: [],
    body: [
      ['Record ID',   capa.id,                  'Type',         capa.type || '—'],
      ['Source',      capa.source || '—',        'Clause',       capa.clause || '—'],
      ['Raised',      capa.raised_at ? String(capa.raised_at).slice(0,10) : '—', 'Due Date', capa.due_date || '—'],
      ['Closed',      capa.closed_at ? String(capa.closed_at).slice(0,10) : '—', 'Owner',    capa.owner || '—'],
    ],
    styles: { fontSize: 9, cellPadding: 4 },
    columnStyles: {
      0: { fontStyle:'bold', fillColor:[240,246,255], cellWidth:38 },
      2: { fontStyle:'bold', fillColor:[240,246,255], cellWidth:38 },
    },
    margin: { left: 14, right: 14 },
    tableLineColor: [224, 221, 212], tableLineWidth: 0.3,
  });

  let y = pdf.lastAutoTable.finalY + 8;
  const maxWidth = width - 28;

  function addPlainSection(label, text) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor('#1C1B18');
    if (y > pdf.internal.pageSize.height - 30) { addPageFooter(pdf, `${capa.id} — Record Detail`); pdf.addPage(); addPageHeader(pdf, `${capa.id} — Record Detail`, capa.title, settings); y = 20; }
    pdf.text(label, 14, y);
    y += 6;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor('#4B4A46');
    const lines = pdf.splitTextToSize(text && text.trim() ? text : 'Not recorded.', maxWidth);
    for (const line of lines) {
      if (y > pdf.internal.pageSize.height - 16) { addPageFooter(pdf, `${capa.id} — Record Detail`); pdf.addPage(); addPageHeader(pdf, `${capa.id} — Record Detail`, capa.title, settings); y = 20; }
      pdf.text(line, 14, y);
      y += 5;
    }
    pdf.setTextColor('#000000');
    y += 6;
  }

  addPlainSection('Nonconformity Detail', capa.detail);
  addPlainSection('Root Cause', capa.root_cause);
  addPlainSection('Corrective Action', capa.action);
  addPageFooter(pdf, `${capa.id} — Record Detail`);

  // ── Next: Evidence — created (rich-text) docs rendered inline ──────────
  for (const att of (evidenceAttachments || [])) {
    if (att.html && att.html.trim()) {
      addHtmlContentPages(pdf, capa, `${capa.id} — Evidence: ${att.title}`, att.html, settings);
    } else if (att.text && att.text.trim()) {
      addContentPages(pdf, capa, `${capa.id} — Evidence: ${att.title}`, att.text, settings);
    }
  }

  // Uploaded PDF evidence files get a banner page + their original pages
  // merged in right after (see mergeUploadedPdfsIntoPdf below) — same
  // mechanism as document attachments.
  const mergeInsertions = [];
  for (const m of (mergePdfs || [])) {
    const headerTitle = `${capa.id} — Evidence: ${m.filename}`;
    addPdfMergeBannerPage(pdf, capa, headerTitle, m.filename, settings);
    mergeInsertions.push({ afterPage: pdf.internal.getNumberOfPages(), fileId: m.fileId, filename: m.filename });
  }

  // ── Last page: Approval History ─────────────────────────────────────────
  addCapaApprovalHistoryPage(pdf, capa, workflowHistory, settings);

  const filename = `${capa.id}_Approved_Closed_Record.pdf`;

  if (mergeInsertions.length === 0) {
    // No uploaded PDF evidence to merge — finish synchronously, same
    // structure as exportSingleDocumentPDF's no-merge path.
    stampWatermark(pdf, 'OFFICIAL RECORD', '#1A7F37');
    finalizePageNumbers(pdf);
    pdf.save(filename);
    return;
  }

  // Mirrors exportSingleDocumentPDF's merge-needed return shape exactly —
  // watermark/page numbers are deliberately NOT applied here; they're
  // applied once, after merging, to the final combined page set by
  // mergeUploadedPdfsIntoPdf().
  return {
    needsMerge: true,
    pdfBytes: pdf.output('arraybuffer'),
    mergeInsertions,
    filename,
    watermarkText: 'OFFICIAL RECORD',
    watermarkColor: '#1A7F37',
  };
}

