import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Trash2, Image as ImageIcon, Save, Building2, Palette, FileText, Type, AlignLeft, AlignCenter, AlignRight, Hash, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { getSettings, setSetting, deleteSetting, getDocumentTypesInUse } from '../api/index';
import { Spinner, SectionHead, ConfirmDialog } from '../components/UI';

const MAX_LOGO_SIZE = 2 * 1024 * 1024;
const DEFAULT_BRAND_COLOR = '#1A56DB';
const COLOR_PRESETS = [
  { label: 'Blue',   value: '#1A56DB' },
  { label: 'Green',  value: '#1A7F37' },
  { label: 'Purple', value: '#6940A5' },
  { label: 'Red',    value: '#A32D2D' },
  { label: 'Slate',  value: '#374151' },
  { label: 'Teal',   value: '#0E7490' },
];
const FONT_OPTIONS = [
  { label: 'Helvetica (Sans-serif)', value: 'helvetica' },
  { label: 'Times (Serif)',          value: 'times' },
  { label: 'Courier (Monospace)',    value: 'courier' },
];
const ALIGN_OPTIONS = [
  { label: 'Left',   value: 'left',   icon: AlignLeft },
  { label: 'Center', value: 'center', icon: AlignCenter },
  { label: 'Right',  value: 'right',  icon: AlignRight },
];
const CAPA_RECORD_TYPES = ['NCR', 'CAPA', 'Observation', 'Opportunity for Improvement'];
const DEFAULT_CAPA_NUMBERING = {
  NCR:    { prefix: 'NCR-',  rules: [] },
  CAPA:   { prefix: 'CAPA-', rules: [] },
  Observation: { prefix: 'OBS-', rules: [] },
  'Opportunity for Improvement': { prefix: 'OFI-', rules: [] },
};
const DEFAULT_DOCUMENT_TYPES = ['SOP', 'Policy', 'Evidence', 'Work Instruction', 'Form/Template', 'Record'];

function AlignPicker({ value, onChange }) {
  return (
    <div style={{ display:'flex', gap:6 }}>
      {ALIGN_OPTIONS.map(opt => {
        const Icon = opt.icon;
        const active = (value || 'center') === opt.value;
        return (
          <button key={opt.value} title={opt.label} onClick={()=>onChange(opt.value)}
            style={{
              width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center',
              border:`1px solid ${active ? 'var(--accent)' : 'var(--border-md)'}`,
              background: active ? 'var(--accent-bg)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-2)',
              borderRadius:'var(--radius-sm)', cursor:'pointer',
            }}>
            <Icon size={14}/>
          </button>
        );
      })}
    </div>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const fileRef = useRef(null);

  const [companyName, setCompanyName]   = useState('');
  const [logoPreview, setLogoPreview]   = useState(null);
  const [delConfirm, setDelConfirm]     = useState(false);

  const [brandColor, setBrandColor]           = useState(DEFAULT_BRAND_COLOR);
  const [coverFooterText, setCoverFooterText] = useState('');
  const [coverFont, setCoverFont]             = useState('helvetica');
  const [coverTitleAlign, setCoverTitleAlign] = useState('center');
  const [coverTitleSize, setCoverTitleSize]   = useState(22);
  const [coverTagline, setCoverTagline]       = useState('');
  const [coverShowStatus, setCoverShowStatus] = useState(true);
  const [coverShowDates, setCoverShowDates]   = useState(true);
  const [coverShowOwner, setCoverShowOwner]   = useState(true);

  const [historyFooterText, setHistoryFooterText]   = useState('');
  const [historyHeaderTitle, setHistoryHeaderTitle] = useState('');
  const [historyFont, setHistoryFont]               = useState('helvetica');
  const [historyTableStyle, setHistoryTableStyle]   = useState('striped');
  const [historyShowApprovedBy, setHistoryShowApprovedBy] = useState(true);
  const [historyShowCreatedBy, setHistoryShowCreatedBy]   = useState(true);
  const [historyIntroText, setHistoryIntroText]     = useState('');

  const [numbering, setNumbering] = useState(DEFAULT_CAPA_NUMBERING);
  const [documentTypes, setDocumentTypes] = useState(DEFAULT_DOCUMENT_TYPES);
  const [newTypeName, setNewTypeName] = useState('');
  const [deleteTypeTarget, setDeleteTypeTarget] = useState(null);

  const { data: settings = {}, isLoading } = useQuery({ queryKey: ['settings'], queryFn: getSettings });

  useEffect(() => {
    const s = settings;
    if (s.company_name !== undefined) setCompanyName(s.company_name || '');
    if (s.cover_brand_color !== undefined) setBrandColor(s.cover_brand_color || DEFAULT_BRAND_COLOR);
    if (s.cover_footer_text !== undefined) setCoverFooterText(s.cover_footer_text || '');
    if (s.cover_font !== undefined) setCoverFont(s.cover_font || 'helvetica');
    if (s.cover_title_align !== undefined) setCoverTitleAlign(s.cover_title_align || 'center');
    if (s.cover_title_size !== undefined) setCoverTitleSize(Number(s.cover_title_size) || 22);
    if (s.cover_tagline !== undefined) setCoverTagline(s.cover_tagline || '');
    if (s.cover_show_status !== undefined) setCoverShowStatus(s.cover_show_status !== 'false');
    if (s.cover_show_dates !== undefined) setCoverShowDates(s.cover_show_dates !== 'false');
    if (s.cover_show_owner !== undefined) setCoverShowOwner(s.cover_show_owner !== 'false');
    if (s.history_footer_text !== undefined) setHistoryFooterText(s.history_footer_text || '');
    if (s.history_header_title !== undefined) setHistoryHeaderTitle(s.history_header_title || '');
    if (s.history_font !== undefined) setHistoryFont(s.history_font || 'helvetica');
    if (s.history_table_style !== undefined) setHistoryTableStyle(s.history_table_style || 'striped');
    if (s.history_show_approved_by !== undefined) setHistoryShowApprovedBy(s.history_show_approved_by !== 'false');
    if (s.history_show_created_by !== undefined) setHistoryShowCreatedBy(s.history_show_created_by !== 'false');
    if (s.history_intro_text !== undefined) setHistoryIntroText(s.history_intro_text || '');
    if (s.capa_numbering !== undefined) {
      try {
        const parsed = JSON.parse(s.capa_numbering || '{}');
        const migrated = {};
        for (const type of CAPA_RECORD_TYPES) {
          const cfg = parsed[type];
          if (!cfg) { migrated[type] = DEFAULT_CAPA_NUMBERING[type]; continue; }
          if (Array.isArray(cfg.rules)) { migrated[type] = cfg; continue; }
          migrated[type] = { prefix: cfg.prefix || '', rules: cfg.suffix ? [{ suffix: cfg.suffix, start_date: null, end_date: null }] : [] };
        }
        setNumbering(migrated);
      } catch (_) {}
    }
    if (s.document_types !== undefined) {
      try {
        const parsed = JSON.parse(s.document_types || '[]');
        if (Array.isArray(parsed) && parsed.length > 0) setDocumentTypes(parsed);
      } catch (_) {}
    }
  }, [settings]);

  const saveLogoMut = useMutation({
    mutationFn: (dataUrl) => setSetting('company_logo', dataUrl),
    onSuccess: () => { qc.invalidateQueries(['settings']); toast.success('Logo updated'); setLogoPreview(null); },
    onError: () => toast.error('Failed to save logo'),
  });
  const removeLogoMut = useMutation({
    mutationFn: () => deleteSetting('company_logo'),
    onSuccess: () => { qc.invalidateQueries(['settings']); toast.success('Logo removed'); },
    onError: () => toast.error('Failed to remove logo'),
  });
  const saveNameMut = useMutation({
    mutationFn: (name) => setSetting('company_name', name),
    onSuccess: () => { qc.invalidateQueries(['settings']); toast.success('Company name saved'); },
    onError: () => toast.error('Failed to save company name'),
  });
  const saveCoverFormatMut = useMutation({
    mutationFn: async () => {
      await Promise.all([
        setSetting('cover_brand_color', brandColor),
        setSetting('cover_footer_text', coverFooterText),
        setSetting('cover_font', coverFont),
        setSetting('cover_title_align', coverTitleAlign),
        setSetting('cover_title_size', String(coverTitleSize)),
        setSetting('cover_tagline', coverTagline),
        setSetting('cover_show_status', String(coverShowStatus)),
        setSetting('cover_show_dates', String(coverShowDates)),
        setSetting('cover_show_owner', String(coverShowOwner)),
      ]);
    },
    onSuccess: () => { qc.invalidateQueries(['settings']); toast.success('Cover page formatting saved'); },
    onError: () => toast.error('Failed to save cover page formatting'),
  });
  const saveHistoryFormatMut = useMutation({
    mutationFn: async () => {
      await Promise.all([
        setSetting('history_header_title', historyHeaderTitle),
        setSetting('history_footer_text', historyFooterText),
        setSetting('history_font', historyFont),
        setSetting('history_table_style', historyTableStyle),
        setSetting('history_show_approved_by', String(historyShowApprovedBy)),
        setSetting('history_show_created_by', String(historyShowCreatedBy)),
        setSetting('history_intro_text', historyIntroText),
      ]);
    },
    onSuccess: () => { qc.invalidateQueries(['settings']); toast.success('Version history page formatting saved'); },
    onError: () => toast.error('Failed to save version history formatting'),
  });
  const saveNumberingMut = useMutation({
    mutationFn: () => {
      const badChars = /[/\\?#%]/;
      for (const [type, cfg] of Object.entries(numbering)) {
        if (badChars.test(cfg.prefix || '')) throw new Error('Prefix cannot contain / \\ ? # or % characters.');
        for (const rule of (cfg.rules || [])) {
          if (badChars.test(rule.suffix || '')) throw new Error(`Suffix "${rule.suffix}" for ${type} cannot contain / \\ ? # or % characters.`);
          if (!rule.suffix || !rule.suffix.trim()) throw new Error(`${type} has a suffix rule with no suffix text — fill it in or remove the rule.`);
          if (!rule.start_date || !rule.end_date) throw new Error(`${type}'s suffix "${rule.suffix}" needs both a start date and an end date.`);
          if (rule.start_date > rule.end_date) throw new Error(`${type}'s suffix "${rule.suffix}" has a start date after its end date.`);
        }
        const rules = cfg.rules || [];
        for (let i = 0; i < rules.length; i++) {
          for (let j = i + 1; j < rules.length; j++) {
            const a = rules[i], b = rules[j];
            if (!(a.end_date < b.start_date) && !(b.end_date < a.start_date)) {
              throw new Error(`${type}: suffix "${a.suffix}" overlaps with suffix "${b.suffix}". Adjust the date ranges.`);
            }
          }
        }
      }
      return setSetting('capa_numbering', JSON.stringify(numbering));
    },
    onSuccess: () => { qc.invalidateQueries(['settings']); toast.success('Record numbering pattern saved'); },
    onError: (e) => toast.error(e.message || 'Failed to save numbering pattern'),
  });
  const addTypeMut = useMutation({
    mutationFn: (name) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Type name cannot be empty');
      if (/[/\\?#%]/.test(trimmed)) throw new Error('Type name cannot contain / \\ ? # or % characters');
      if (documentTypes.some(t => t.toLowerCase() === trimmed.toLowerCase())) throw new Error(`"${trimmed}" already exists`);
      const updated = [...documentTypes, trimmed];
      return setSetting('document_types', JSON.stringify(updated)).then(() => updated);
    },
    onSuccess: (updated) => { setDocumentTypes(updated); setNewTypeName(''); qc.invalidateQueries(['settings']); toast.success('Document type added'); },
    onError: (e) => toast.error(e.message || 'Failed to add document type'),
  });
  const deleteTypeMut = useMutation({
    mutationFn: async (type) => {
      const inUse = await getDocumentTypesInUse();
      const usage = inUse.find(u => u.type === type);
      if (usage) throw new Error(`Can't delete "${type}" — ${usage.count} document${usage.count > 1 ? 's' : ''} currently use this type.`);
      const updated = documentTypes.filter(t => t !== type);
      if (updated.length === 0) throw new Error('At least one document type must remain');
      return setSetting('document_types', JSON.stringify(updated)).then(() => updated);
    },
    onSuccess: (updated) => { setDocumentTypes(updated); setDeleteTypeTarget(null); qc.invalidateQueries(['settings']); toast.success('Document type removed'); },
    onError: (e) => { toast.error(e.message || 'Failed to remove document type'); setDeleteTypeTarget(null); },
  });

  function handleFileSelect(e) {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image file (PNG, JPG, SVG)'); return; }
    if (file.size > MAX_LOGO_SIZE) { toast.error('Logo must be under 2 MB'); return; }
    const reader = new FileReader();
    reader.onload = () => setLogoPreview(reader.result);
    reader.readAsDataURL(file);
  }

  function updateNumbering(type, field, value) {
    setNumbering(prev => ({ ...prev, [type]: { ...prev[type], [field]: value } }));
  }
  function addNumberingRule(type) {
    setNumbering(prev => ({ ...prev, [type]: { ...prev[type], rules: [...(prev[type].rules || []), { suffix: '', start_date: '', end_date: '' }] } }));
  }
  function updateNumberingRule(type, index, field, value) {
    setNumbering(prev => {
      const rules = [...(prev[type].rules || [])];
      rules[index] = { ...rules[index], [field]: value };
      return { ...prev, [type]: { ...prev[type], rules } };
    });
  }
  function removeNumberingRule(type, index) {
    setNumbering(prev => {
      const rules = (prev[type].rules || []).filter((_, i) => i !== index);
      return { ...prev, [type]: { ...prev[type], rules } };
    });
  }

  const currentLogo = settings.company_logo;
  const fontFamilyCss = { helvetica: 'Helvetica, Arial, sans-serif', times: 'Georgia, Times, serif', courier: 'Courier New, monospace' };

  return (
    <div className="page">
      <div className="flex-between mb-16">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-sub">Configure company branding and PDF page formatting</div>
        </div>
      </div>

      {isLoading ? <Spinner/> : (
        <div style={{ display:'flex', flexDirection:'column', gap:16, maxWidth: 680 }}>

          <div className="card">
            <div className="card-body">
              <SectionHead>Company Branding</SectionHead>
              <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:16, marginTop:12 }}>
                <div style={{ width:80, height:80, borderRadius:'var(--radius-md)', border:'1px solid var(--border)', background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', flexShrink:0 }}>
                  {logoPreview ? <img src={logoPreview} alt="Logo preview" style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain' }}/> :
                   currentLogo ? <img src={currentLogo} alt="Company logo" style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain' }}/> :
                   <div style={{ width:48, height:48, borderRadius:'50%', background: brandColor, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:24 }}>C</div>}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:500, marginBottom:2 }}>{logoPreview ? 'New logo (not saved yet)' : currentLogo ? 'Current logo' : 'Default logo'}</div>
                  <div style={{ fontSize:12, color:'var(--text-2)' }}>{logoPreview ? 'Click "Save Logo" to apply' : currentLogo ? 'Used on PDF cover pages' : 'Upload an image to customize'}</div>
                </div>
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <input type="file" ref={fileRef} style={{ display:'none' }} accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={handleFileSelect}/>
                <button className="btn btn-sm" onClick={()=>fileRef.current?.click()}><Upload size={13}/> Choose Image</button>
                {logoPreview && <>
                  <button className="btn btn-sm btn-primary" onClick={()=>saveLogoMut.mutate(logoPreview)} disabled={saveLogoMut.isPending}><Save size={13}/> {saveLogoMut.isPending ? 'Saving...' : 'Save Logo'}</button>
                  <button className="btn btn-sm btn-ghost" onClick={()=>setLogoPreview(null)}>Cancel</button>
                </>}
                {!logoPreview && currentLogo && <button className="btn btn-sm btn-ghost" style={{ color:'var(--red)' }} onClick={()=>setDelConfirm(true)}><Trash2 size={13}/> Remove Logo</button>}
              </div>
              <div style={{ borderTop:'1px solid var(--border)', margin:'20px 0' }}/>
              <SectionHead>Company Name</SectionHead>
              <div style={{ display:'flex', gap:8, marginTop:10 }}>
                <div style={{ flex:1, position:'relative' }}>
                  <Building2 size={14} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-3)' }}/>
                  <input style={{ paddingLeft:32 }} value={companyName} onChange={e=>setCompanyName(e.target.value)} placeholder="CognifAI"/>
                </div>
                <button className="btn btn-sm btn-primary" onClick={()=>saveNameMut.mutate(companyName)} disabled={saveNameMut.isPending}><Save size={13}/> Save</button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <SectionHead>Cover Page Formatting (Page 1)</SectionHead>
              <div className="form-2col" style={{ marginTop:14 }}>
                <div className="form-row">
                  <label>Brand Color</label>
                  <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                    <input type="color" value={brandColor} onChange={e=>setBrandColor(e.target.value)} style={{ width:44, height:32, padding:2, cursor:'pointer' }}/>
                    <input value={brandColor} onChange={e=>setBrandColor(e.target.value)} style={{ width:90, fontFamily:'var(--mono)', fontSize:12 }}/>
                  </div>
                  <div style={{ display:'flex', gap:6, marginTop:6 }}>
                    {COLOR_PRESETS.map(c => <button key={c.value} title={c.label} onClick={()=>setBrandColor(c.value)} style={{ width:22, height:22, borderRadius:'50%', background:c.value, border: brandColor===c.value ? '2px solid var(--text-1)' : '2px solid transparent', cursor:'pointer', padding:0 }}/>)}
                  </div>
                </div>
                <div className="form-row">
                  <label>Font</label>
                  <select value={coverFont} onChange={e=>setCoverFont(e.target.value)}>
                    {FONT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-2col">
                <div className="form-row"><label>Title Alignment</label><AlignPicker value={coverTitleAlign} onChange={setCoverTitleAlign}/></div>
                <div className="form-row"><label>Title Font Size — {coverTitleSize}pt</label><input type="range" min={14} max={32} step={1} value={coverTitleSize} onChange={e=>setCoverTitleSize(Number(e.target.value))} style={{ padding:0, marginTop:8 }}/></div>
              </div>
              <div className="form-row"><label>Tagline / Subtitle</label><input value={coverTagline} onChange={e=>setCoverTagline(e.target.value)} placeholder="e.g. Quality Management System Document"/></div>
              <div className="form-row"><label>Footer Text</label><input value={coverFooterText} onChange={e=>setCoverFooterText(e.target.value)} placeholder={`${companyName || 'CognifAI'} · QMS DocControl · ISO 9001 & ISO 27001`}/></div>
              <div className="form-row">
                <label>Show on Cover Page</label>
                <div style={{ display:'flex', gap:16, flexWrap:'wrap', marginTop:4 }}>
                  {[['Status line', coverShowStatus, setCoverShowStatus],['Version date', coverShowDates, setCoverShowDates],['Owner', coverShowOwner, setCoverShowOwner]].map(([label, val, setter]) => (
                    <label key={label} style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer', fontWeight:400 }}>
                      <input type="checkbox" checked={val} onChange={e=>setter(e.target.checked)} style={{ width:'auto', margin:0 }}/>{label}
                    </label>
                  ))}
                </div>
              </div>
              <button className="btn btn-sm btn-primary" style={{ marginTop:14 }} onClick={()=>saveCoverFormatMut.mutate()} disabled={saveCoverFormatMut.isPending}>
                <Palette size={13}/> {saveCoverFormatMut.isPending ? 'Saving...' : 'Save Cover Page Formatting'}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <SectionHead>Version History Page Formatting (Final Page)</SectionHead>
              <div className="form-2col" style={{ marginTop:14 }}>
                <div className="form-row"><label>Page Title</label><input value={historyHeaderTitle} onChange={e=>setHistoryHeaderTitle(e.target.value)} placeholder="Version History"/></div>
                <div className="form-row"><label>Font</label><select value={historyFont} onChange={e=>setHistoryFont(e.target.value)}>{FONT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select></div>
              </div>
              <div className="form-row">
                <label>Table Style</label>
                <div style={{ display:'flex', gap:8 }}>
                  {[{value:'striped',label:'Striped rows'},{value:'grid',label:'Grid lines'},{value:'plain',label:'Plain'}].map(opt => (
                    <button key={opt.value} onClick={()=>setHistoryTableStyle(opt.value)} style={{ padding:'6px 14px', fontSize:12, borderRadius:'var(--radius-sm)', cursor:'pointer', border:`1px solid ${historyTableStyle===opt.value?'var(--accent)':'var(--border-md)'}`, background:historyTableStyle===opt.value?'var(--accent-bg)':'transparent', color:historyTableStyle===opt.value?'var(--accent)':'var(--text-2)' }}>{opt.label}</button>
                  ))}
                </div>
              </div>
              <div className="form-row"><label>Intro Text</label><input value={historyIntroText} onChange={e=>setHistoryIntroText(e.target.value)} placeholder="e.g. This table records all approved revisions to this document."/></div>
              <div className="form-row"><label>Footer Text</label><input value={historyFooterText} onChange={e=>setHistoryFooterText(e.target.value)} placeholder="Doc ID — Version History"/></div>
              <div className="form-row">
                <label>Table Columns</label>
                <div style={{ display:'flex', gap:16, flexWrap:'wrap', marginTop:4 }}>
                  {[['Created By', historyShowCreatedBy, setHistoryShowCreatedBy],['Approved By', historyShowApprovedBy, setHistoryShowApprovedBy]].map(([label, val, setter]) => (
                    <label key={label} style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer', fontWeight:400 }}>
                      <input type="checkbox" checked={val} onChange={e=>setter(e.target.checked)} style={{ width:'auto', margin:0 }}/>{label}
                    </label>
                  ))}
                </div>
              </div>
              <button className="btn btn-sm btn-primary" style={{ marginTop:14 }} onClick={()=>saveHistoryFormatMut.mutate()} disabled={saveHistoryFormatMut.isPending}>
                <FileText size={13}/> {saveHistoryFormatMut.isPending ? 'Saving...' : 'Save Version History Formatting'}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <SectionHead>Record Numbering — NCR / CAPA Register</SectionHead>
              <div style={{ display:'flex', flexDirection:'column', gap:20, marginTop:14 }}>
                {CAPA_RECORD_TYPES.map(type => {
                  const cfg = numbering[type] || { prefix: '', rules: [] };
                  const rules = cfg.rules || [];
                  const previewRule = rules[0];
                  const preview = previewRule && previewRule.suffix ? `${cfg.prefix||''}001-${previewRule.suffix}` : `${cfg.prefix||''}001`;
                  return (
                    <div key={type} style={{ paddingBottom:16, borderBottom:'1px solid var(--border)' }}>
                      <div style={{ display:'grid', gridTemplateColumns:'140px 1fr 1fr', gap:10, alignItems:'end', marginBottom:10 }}>
                        <div style={{ fontSize:13, fontWeight:600 }}>{type}</div>
                        <div className="form-row" style={{ marginBottom:0 }}>
                          <label style={{ fontSize:11 }}>Prefix</label>
                          <input value={cfg.prefix||''} onChange={e=>updateNumbering(type,'prefix',e.target.value)} placeholder="e.g. NCR-"/>
                        </div>
                        <div style={{ fontSize:12, color:'var(--text-2)' }}>Preview: <span style={{ fontFamily:'var(--mono)', background:'var(--bg-hover)', padding:'3px 8px', borderRadius:4 }}>{preview}</span></div>
                      </div>
                      {rules.length > 0 && (
                        <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:10 }}>
                          {rules.map((rule, idx) => (
                            <div key={idx} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 32px', gap:8, alignItems:'end', padding:'8px 10px', background:'var(--bg-hover)', borderRadius:'var(--radius-md)' }}>
                              <div className="form-row" style={{ marginBottom:0 }}><label style={{ fontSize:10 }}>Suffix</label><input value={rule.suffix||''} onChange={e=>updateNumberingRule(type,idx,'suffix',e.target.value)} placeholder="e.g. 2026"/></div>
                              <div className="form-row" style={{ marginBottom:0 }}><label style={{ fontSize:10 }}>Start date</label><input type="date" value={rule.start_date||''} onChange={e=>updateNumberingRule(type,idx,'start_date',e.target.value)}/></div>
                              <div className="form-row" style={{ marginBottom:0 }}><label style={{ fontSize:10 }}>End date</label><input type="date" value={rule.end_date||''} onChange={e=>updateNumberingRule(type,idx,'end_date',e.target.value)}/></div>
                              <button className="btn btn-ghost btn-icon btn-sm" onClick={()=>removeNumberingRule(type,idx)}><Trash2 size={13}/></button>
                            </div>
                          ))}
                        </div>
                      )}
                      <button className="btn btn-sm" onClick={()=>addNumberingRule(type)}><Plus size={13}/> Add Suffix Rule</button>
                    </div>
                  );
                })}
              </div>
              <button className="btn btn-sm btn-primary" style={{ marginTop:16 }} onClick={()=>saveNumberingMut.mutate()} disabled={saveNumberingMut.isPending}>
                <Hash size={13}/> {saveNumberingMut.isPending ? 'Saving...' : 'Save Numbering Pattern'}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-body">
              <SectionHead>Document Types</SectionHead>
              <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14, marginTop:14 }}>
                {documentTypes.map(type => (
                  <div key={type} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', background:'var(--bg-hover)', borderRadius:'var(--radius-md)' }}>
                    <span style={{ fontSize:13 }}>{type}</span>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setDeleteTypeTarget(type)} disabled={deleteTypeMut.isPending}><Trash2 size={13}/></button>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <input value={newTypeName} onChange={e => setNewTypeName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newTypeName.trim()) addTypeMut.mutate(newTypeName); }} placeholder="e.g. Manual, Checklist, Drawing" style={{ flex: 1 }}/>
                <button className="btn btn-sm btn-primary" onClick={() => addTypeMut.mutate(newTypeName)} disabled={addTypeMut.isPending || !newTypeName.trim()}><Plus size={13}/> {addTypeMut.isPending ? 'Adding...' : 'Add Type'}</button>
              </div>
            </div>
          </div>

          <div style={{ fontSize:12, color:'var(--text-3)', display:'flex', alignItems:'center', gap:6 }}>
            <ImageIcon size={14}/>
            These settings apply to every exported PDF.
          </div>
        </div>
      )}

      <ConfirmDialog open={delConfirm} onClose={()=>setDelConfirm(false)} danger title="Remove Company Logo" message="The PDF cover page will revert to the default logo." onConfirm={()=>removeLogoMut.mutate()}/>
      <ConfirmDialog open={!!deleteTypeTarget} onClose={()=>setDeleteTypeTarget(null)} danger title="Remove Document Type" message={`Remove "${deleteTypeTarget}" from the document types list?`} onConfirm={()=>deleteTypeMut.mutate(deleteTypeTarget)}/>
    </div>
  );
}
