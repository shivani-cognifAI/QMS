import React, { useRef, useEffect, useMemo } from 'react';

// SSR guard — ReactQuill and Quill only work in the browser
if (typeof window === 'undefined') {
  // module-level guard: no import happens on the server
}

let ReactQuill, Quill;
if (typeof window !== 'undefined') {
  ReactQuill = require('react-quill').default;
  Quill = require('react-quill').Quill;
  require('react-quill/dist/quill.snow.css');
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE SUPPORT FOR QUILL
// ─────────────────────────────────────────────────────────────────────────────
let tableSupportRegistered = false;

const FONT_WHITELIST = ['arial', 'georgia', 'times-new-roman', 'courier-new', 'verdana', 'calibri', 'tahoma'];
const FONT_LABELS = { arial:'Arial', georgia:'Georgia', 'times-new-roman':'Times New Roman', 'courier-new':'Courier New', verdana:'Verdana', calibri:'Calibri', tahoma:'Tahoma' };
const SIZE_WHITELIST = ['8px','10px','12px','14px','16px','18px','20px','24px','32px'];

function registerTableSupport() {
  if (tableSupportRegistered || typeof window === 'undefined' || !Quill) return;
  tableSupportRegistered = true;

  const Font = Quill.import('formats/font');
  Font.whitelist = FONT_WHITELIST;
  Quill.register(Font, true);

  const Size = Quill.import('formats/size');
  Size.whitelist = SIZE_WHITELIST;
  Quill.register(Size, true);

  const BlockEmbed = Quill.import('blots/block/embed');

  class TableHtmlBlot extends BlockEmbed {
    static create(value) {
      const node = super.create();
      node.innerHTML = value;
      node.setAttribute('contenteditable', 'false');
      node.classList.add('ql-table-html-blot');
      node.querySelectorAll('td, th').forEach(cell => cell.setAttribute('contenteditable', 'true'));
      return node;
    }
    static value(node) {
      const clone = node.cloneNode(true);
      clone.querySelectorAll('td, th').forEach(cell => cell.removeAttribute('contenteditable'));
      return clone.innerHTML;
    }
  }
  TableHtmlBlot.blotName = 'tableHtml';
  TableHtmlBlot.tagName = 'div';
  TableHtmlBlot.className = 'ql-table-html-blot';

  Quill.register(TableHtmlBlot, true);
}

function buildTableSkeleton(rows, cols) {
  let html = '<table>';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      html += r === 0 ? '<td><strong>Header</strong></td>' : '<td>&nbsp;</td>';
    }
    html += '</tr>';
  }
  html += '</table>';
  return html;
}

const TOOLBAR_MODULES = {
  toolbar: {
    container: [
      [{ font: FONT_WHITELIST }, { size: SIZE_WHITELIST }],
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ indent: '-1' }, { indent: '+1' }],
      [{ align: [] }],
      ['blockquote', 'code-block'],
      [{ color: [] }, { background: [] }],
      ['link'],
      ['insertTable'],
      ['insertImage'],
      ['clean'],
    ],
    handlers: {
      insertTable: function () {},
      insertImage: function () {},
    },
  },
};

export default function RichTextEditor({ value, onChange, placeholder, minHeight = 140 }) {
  // SSR guard — return loading placeholder during server-side render
  if (typeof window === 'undefined') {
    return <div style={{ minHeight, border: '1px solid var(--border-md)', borderRadius: 'var(--radius-md)', padding: 10, color: 'var(--text-3)' }}>Loading editor...</div>;
  }

  registerTableSupport();
  const quillRef = useRef(null);

  useEffect(() => {
    const editor = quillRef.current?.getEditor?.();
    if (!editor) return;
    const clipboard = editor.getModule('clipboard');
    const Delta = Quill.import('delta');

    clipboard.addMatcher('table', (node) => {
      return new Delta().insert({ tableHtml: node.outerHTML });
    });

    const toolbar = editor.getModule('toolbar');
    toolbar.addHandler('insertTable', () => {
      const rowsInput = window.prompt('Number of rows (including header row):', '3');
      if (rowsInput === null) return;
      const colsInput = window.prompt('Number of columns:', '3');
      if (colsInput === null) return;

      const rows = Math.max(1, Math.min(20, parseInt(rowsInput, 10) || 3));
      const cols = Math.max(1, Math.min(10, parseInt(colsInput, 10) || 3));

      const range = editor.getSelection(true);
      const index = range ? range.index : editor.getLength();
      editor.insertEmbed(index, 'tableHtml', buildTableSkeleton(rows, cols), 'user');
      editor.insertText(index + 1, '\n', 'user');
      editor.setSelection(index + 2, 0);
    });

    function insertImageFile(file, index) {
      if (!file || !file.type || !file.type.startsWith('image/')) return;
      if (file.size > 8 * 1024 * 1024) {
        window.alert('That image is larger than 8MB — please use a smaller image or screenshot.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const insertAt = index != null ? index : (editor.getSelection(true)?.index ?? editor.getLength());
        editor.insertEmbed(insertAt, 'image', reader.result, 'user');
        editor.setSelection(insertAt + 1, 0);
      };
      reader.readAsDataURL(file);
    }

    toolbar.addHandler('insertImage', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files && input.files[0];
        const range = editor.getSelection(true);
        insertImageFile(file, range ? range.index : editor.getLength());
      };
      input.click();
    });

    function handlePasteImage(e) {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (!file) continue;
          e.preventDefault();
          e.stopImmediatePropagation();
          const range = editor.getSelection(true);
          insertImageFile(file, range ? range.index : editor.getLength());
          return;
        }
      }
    }
    editor.root.addEventListener('paste', handlePasteImage, true);

    const btn = toolbar.container.querySelector('.ql-insertTable');
    if (btn && !btn.innerHTML) {
      btn.innerHTML = `<svg viewBox="0 0 18 18"><rect class="ql-stroke" height="14" width="14" x="2" y="2" rx="1" fill="none"></rect><line class="ql-stroke" x1="2" x2="16" y1="7" y2="7"></line><line class="ql-stroke" x1="2" x2="16" y1="11.5" y2="11.5"></line><line class="ql-stroke" x1="7" x2="7" y1="2" y2="16"></line></svg>`;
      btn.title = 'Insert table';
    }
    const imageBtn = toolbar.container.querySelector('.ql-insertImage');
    if (imageBtn && !imageBtn.innerHTML) {
      imageBtn.innerHTML = `<svg viewBox="0 0 18 18"><rect class="ql-stroke" height="12" width="14" x="2" y="3" rx="1" fill="none"></rect><circle class="ql-fill" cx="6" cy="7.5" r="1.3"></circle><path class="ql-stroke" d="M3,13.5 L7.5,9.5 L10.5,12 L13,9.5 L15,12" fill="none"></path></svg>`;
      imageBtn.title = 'Insert image';
    }

    toolbar.container.querySelectorAll('.ql-picker.ql-font .ql-picker-item').forEach(item => {
      const val = item.getAttribute('data-value');
      if (FONT_LABELS[val]) item.setAttribute('data-label', FONT_LABELS[val]);
    });
    const fontPickerLabel = toolbar.container.querySelector('.ql-picker.ql-font .ql-picker-label');
    if (fontPickerLabel) {
      const val = fontPickerLabel.getAttribute('data-value');
      if (FONT_LABELS[val]) fontPickerLabel.setAttribute('data-label', FONT_LABELS[val]);
    }
    toolbar.container.querySelectorAll('.ql-picker.ql-size .ql-picker-item').forEach(item => {
      const val = item.getAttribute('data-value');
      if (val) item.setAttribute('data-label', val);
    });
    const sizePickerLabel = toolbar.container.querySelector('.ql-picker.ql-size .ql-picker-label');
    if (sizePickerLabel) {
      const val = sizePickerLabel.getAttribute('data-value');
      if (val) sizePickerLabel.setAttribute('data-label', val);
    }

    function TableHtmlBlot_value(node) {
      const clone = node.cloneNode(true);
      clone.querySelectorAll('td, th').forEach(c => c.removeAttribute('contenteditable'));
      return clone.innerHTML;
    }

    function handleTableFocusOut(e) {
      const cell = e.target.closest && e.target.closest('td, th');
      if (!cell) return;
      const tableNode = cell.closest('.ql-table-html-blot');
      if (!tableNode || !editor.root.contains(tableNode)) return;

      const blot = Quill.find(tableNode);
      if (!blot) return;

      const Delta = Quill.import('delta');
      const offset = blot.offset(editor.scroll);
      const freshValue = TableHtmlBlot_value(tableNode);
      editor.updateContents(new Delta().retain(offset).delete(1).insert({ tableHtml: freshValue }), 'user');
    }

    editor.root.addEventListener('focusout', handleTableFocusOut, true);

    return () => {
      editor.root.removeEventListener('focusout', handleTableFocusOut, true);
      editor.root.removeEventListener('paste', handlePasteImage, true);
    };
  }, []);

  const modules = useMemo(() => TOOLBAR_MODULES, []);

  return (
    <div className="quill-wrap" style={{ '--quill-min-height': `${minHeight}px` }}>
      <ReactQuill
        ref={quillRef}
        theme="snow"
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        modules={modules}
      />
    </div>
  );
}
