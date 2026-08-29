import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { todayStr, timeAgo } from '../../lib/date';
import { useConfirm } from '../../lib/useConfirm';
import IconActionButton from '../../components/IconActionButton';
import Pagination from '../../components/Pagination';
import { DownloadIcon, PencilIcon, TrashIcon, PlusIcon, CheckCircleIcon } from '../../components/icons';

function nowStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function emptyItemMap(count) {
  const m = {};
  for (let i = 0; i < count; i++) m[i] = { value: null, comment: '' };
  return m;
}

function newVilla() {
  return { villaNumber: '', items: {} };
}
function newGuestRow() {
  return { villaGuest: '', comment: '' };
}
function newIssue() {
  return { photo: '', caption: '' };
}

// Resized + re-encoded client-side before upload — a MOD report can carry
// several issue photos in one submission (unlike a single payment-proof
// upload elsewhere in this app), so keeping each one small matters more
// here than it does there. 1000px/0.62 mirrors the same tradeoff every
// other client-side image compression in this codebase's own history has
// landed on: small enough to stay well under the backend's 8mb JSON body
// cap even with several photos, still clearly legible.
function compressImage(file, maxDim = 1000, quality = 0.62) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > h && w > maxDim) { h = Math.round((h * maxDim) / w); w = maxDim; }
        else if (h >= w && h > maxDim) { w = Math.round((w * maxDim) / h); h = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function newDraft(sections) {
  const sectionAnswers = {};
  (sections || []).forEach((s) => { sectionAnswers[s.key] = emptyItemMap(s.items.length); });
  return {
    mod_name: '',
    report_date: todayStr(),
    weather: '',
    time_started: nowStr(),
    occupancy_percent: '',
    sections: sectionAnswers,
    villas: [newVilla()],
    guestInteractions: [newGuestRow(), newGuestRow(), newGuestRow()],
    issues: [],
    signature: '',
  };
}

function draftFromReport(report, sections) {
  const sectionAnswers = {};
  (sections || []).forEach((s) => { sectionAnswers[s.key] = { ...emptyItemMap(s.items.length), ...(report.sections[s.key] || {}) }; });
  return {
    mod_name: report.mod_name || '',
    report_date: report.report_date || todayStr(),
    weather: report.weather || '',
    time_started: report.time_started || '',
    occupancy_percent: report.occupancy_percent === null || report.occupancy_percent === undefined ? '' : report.occupancy_percent,
    sections: sectionAnswers,
    villas: (report.villas || []).length ? report.villas.map((v) => ({ villaNumber: v.villaNumber || '', items: v.items || {} })) : [newVilla()],
    guestInteractions: (report.guestInteractions || []).length ? report.guestInteractions : [newGuestRow(), newGuestRow(), newGuestRow()],
    issues: report.issues || [],
    signature: report.signature || '',
  };
}

function tally(itemMap, count) {
  let yes = 0, no = 0, na = 0, answered = 0;
  for (let i = 0; i < count; i++) {
    const v = itemMap && itemMap[i] && itemMap[i].value;
    if (v === 'yes') { yes++; answered++; }
    else if (v === 'no') { no++; answered++; }
    else if (v === 'na') { na++; answered++; }
  }
  return { yes, no, na, answered, total: count };
}

const PILL_ACTIVE = {
  yes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  no: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  na: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
};

function PillGroup({ value, onChange }) {
  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-slate-300 dark:border-slate-600">
      {['yes', 'no', 'na'].map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(value === v ? null : v)}
          className={`min-h-9 px-3 text-xs font-bold uppercase tracking-wide ${value === v ? PILL_ACTIVE[v] : 'bg-white text-slate-500 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'}`}
        >
          {v === 'na' ? 'N/A' : v}
        </button>
      ))}
    </div>
  );
}

function ItemRow({ label, itemState, onChange }) {
  const value = (itemState && itemState.value) || null;
  const comment = (itemState && itemState.comment) || '';
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-t border-slate-100 px-4 py-3 first:border-t-0 dark:border-slate-800">
      <div className="min-w-0 flex-1 basis-64 text-sm text-slate-800 dark:text-slate-200">{label}</div>
      <PillGroup value={value} onChange={(v) => onChange({ value: v, comment })} />
      <input
        type="text"
        placeholder="Comment (optional)"
        value={comment}
        onChange={(e) => onChange({ value, comment: e.target.value })}
        className="min-h-9 w-full flex-1 basis-full rounded-md border border-transparent bg-slate-50 px-2.5 py-1.5 text-base focus:border-lagoon-500 focus:bg-white focus:outline-none dark:bg-slate-800 dark:text-white dark:focus:bg-slate-900"
      />
    </div>
  );
}

// A section that's independently collapsible at every width (unlike
// components/Accordion.jsx, which forces itself open at sm+ — fine for one
// or two sections on a detail page, but this checklist has 15 of them, and
// forcing every one open on desktop would be an overwhelming wall of
// content rather than a scannable list). "Tick all Yes" lives inside the
// <summary> and stops its click from bubbling so it doesn't also toggle
// the section open/closed.
function ChecklistSection({ title, items, answers, onItemChange, onMarkAllYes, defaultOpen = false }) {
  const t = tally(answers, items.length);
  return (
    <details open={defaultOpen} className="group rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 [&::-webkit-details-marker]:hidden group-open:rounded-b-none">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-slate-400 transition-transform group-open:rotate-90">
          <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
        <span
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMarkAllYes(); }}
          className="cursor-pointer whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
        >
          Tick all Yes
        </span>
        <span className={`whitespace-nowrap text-xs font-bold ${t.answered === t.total ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
          {t.answered}/{t.total}
        </span>
      </summary>
      <div className="border-t border-slate-200 dark:border-slate-700">
        {items.map((label, idx) => (
          <ItemRow key={idx} label={label} itemState={answers[idx]} onChange={(next) => onItemChange(idx, next)} />
        ))}
      </div>
    </details>
  );
}

function Field({ label, children }) {
  return (
    // min-w-0 overrides a grid item's default min-width: auto, which
    // otherwise lets a native date/time input's own intrinsic minimum
    // width (the calendar/clock control) push its whole grid cell wider
    // than the column actually allows, overflowing the card on a narrow
    // phone instead of the input just shrinking to fit like every other
    // field's w-full does.
    <label className="block min-w-0">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}
const inputClass = 'mt-1 h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-white';
// A native date/time control's own compound widget (spinner segments,
// calendar/clock icon) is drawn by the OS/browser, not by us — on some
// mobile browsers that internal rendering ignores an explicit CSS
// height/width entirely and forces its own larger box instead, which is
// what actually caused these two fields to grow taller AND wider than
// their siblings despite sharing the identical h-11/w-full classes.
// appearance-none tells the browser to stop drawing that native widget
// frame and let our own border/height/width own the box completely —
// tapping the field still opens the OS date/time picker either way, this
// only changes how the closed field itself is drawn.
const dateTimeInputClass = `${inputClass} appearance-none [-webkit-appearance:none]`;

// Same shape as pages/business/Settings.jsx's own ImageField (PNG/JPEG,
// 400KB cap, read as a data URI via FileReader) — a small, deliberate
// duplication rather than an import, since this branding is stored in its
// own mod_report_settings table (see routes/modReports.js) and is meant
// to stay fully independent of the app's own business_settings.
const MOD_MAX_IMAGE_BYTES = 400 * 1024;
const MOD_ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg'];

function ModLogoField({ value, onChange, onError }) {
  function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    onError('');
    if (!MOD_ALLOWED_IMAGE_TYPES.includes(file.type)) {
      onError('Logo must be a PNG or JPEG image');
      return;
    }
    if (file.size > MOD_MAX_IMAGE_BYTES) {
      onError('Logo must be smaller than 400KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result);
    reader.onerror = () => onError('Could not read the selected logo file');
    reader.readAsDataURL(file);
  }

  return (
    <div className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Logo</span>
      {value ? (
        <div className="mt-1 flex items-center gap-3">
          <img src={value} alt="Logo" className="h-16 max-w-[160px] rounded-md border border-slate-200 object-contain dark:border-slate-700" />
          <button
            type="button"
            onClick={() => onChange('')}
            className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Remove
          </button>
        </div>
      ) : (
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={handleFile}
          className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:min-h-11 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50 dark:text-slate-400 dark:file:border-slate-600 dark:file:bg-slate-800 dark:file:text-slate-200 dark:hover:file:bg-slate-700"
        />
      )}
      <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
        Printed at the top of the MOD report PDF. Separate from the business's own logo on Settings — this checklist is deliberately unbranded from EduSolution.
      </span>
    </div>
  );
}

function ModSettingsForm({ settings, setSettings, onSubmit, submitting, error, setError, success }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex max-w-lg flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
    >
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Sets the name and logo printed on the MOD report PDF. This is its own, separate branding — it never reads from or writes to the business's own Settings page.
      </p>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {success && <p className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>}
      <ModLogoField value={settings.logo_image} onChange={(v) => setSettings((s) => ({ ...s, logo_image: v }))} onError={setError} />
      <Field label="Business / property name">
        <input
          type="text"
          value={settings.business_name}
          onChange={(e) => setSettings((s) => ({ ...s, business_name: e.target.value }))}
          placeholder="e.g. Miladhoo Island Resort"
          className={inputClass}
        />
      </Field>
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-md bg-lagoon-600 px-5 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
      >
        <CheckCircleIcon className="h-4 w-4" />
        {submitting ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

function ChecklistForm({ meta, draft, setDraft, editingId, onSubmit, onCancelEdit, submitting, error }) {
  const overall = { answered: 0, total: 0 };
  meta.sections.forEach((s) => {
    const t = tally(draft.sections[s.key], s.items.length);
    overall.answered += t.answered;
    overall.total += t.total;
  });
  draft.villas.forEach((v) => {
    const t = tally(v.items, meta.villaItems.length);
    overall.answered += t.answered;
    overall.total += t.total;
  });
  const pct = overall.total ? Math.round((overall.answered / overall.total) * 100) : 0;

  function updateSectionItem(key, idx, next) {
    setDraft((d) => ({ ...d, sections: { ...d.sections, [key]: { ...d.sections[key], [idx]: next } } }));
  }
  function markAllYesSection(key, count) {
    setDraft((d) => {
      const updated = {};
      for (let i = 0; i < count; i++) updated[i] = { value: 'yes', comment: (d.sections[key][i] || {}).comment || '' };
      return { ...d, sections: { ...d.sections, [key]: updated } };
    });
  }
  function updateVillaItem(vIdx, idx, next) {
    setDraft((d) => {
      const villas = d.villas.map((v, i) => (i === vIdx ? { ...v, items: { ...v.items, [idx]: next } } : v));
      return { ...d, villas };
    });
  }
  function markAllYesVilla(vIdx, count) {
    setDraft((d) => {
      const villas = d.villas.map((v, i) => {
        if (i !== vIdx) return v;
        const updated = {};
        for (let j = 0; j < count; j++) updated[j] = { value: 'yes', comment: (v.items[j] || {}).comment || '' };
        return { ...v, items: updated };
      });
      return { ...d, villas };
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-col gap-4"
    >
      {editingId && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <PencilIcon className="h-4 w-4 shrink-0" />
          <span>
            Editing <strong>{draft.mod_name || 'this report'}</strong> — save to update the report already in the log, or cancel to leave it as it was.
          </span>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="grid grid-cols-2 gap-3">
          <Field label="MOD Name">
            <input type="text" required value={draft.mod_name} onChange={(e) => setDraft((d) => ({ ...d, mod_name: e.target.value }))} placeholder="Your name" className={inputClass} />
          </Field>
          <Field label="Date">
            <input type="date" required value={draft.report_date} onChange={(e) => setDraft((d) => ({ ...d, report_date: e.target.value }))} className={dateTimeInputClass} />
          </Field>
          <Field label="Time started">
            <input type="time" value={draft.time_started} onChange={(e) => setDraft((d) => ({ ...d, time_started: e.target.value }))} className={dateTimeInputClass} />
          </Field>
          <Field label="Weather">
            <input type="text" value={draft.weather} onChange={(e) => setDraft((d) => ({ ...d, weather: e.target.value }))} placeholder="e.g. mostly cloudy" className={inputClass} />
          </Field>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Occupancy %">
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={draft.occupancy_percent}
              onChange={(e) => setDraft((d) => ({ ...d, occupancy_percent: e.target.value }))}
              placeholder="e.g. 62.5"
              className={inputClass}
            />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-lagoon-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
            {overall.answered} / {overall.total} checked ({pct}%)
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {meta.sections.map((s) => (
          <ChecklistSection
            key={s.key}
            title={s.title}
            items={s.items}
            answers={draft.sections[s.key] || {}}
            onItemChange={(idx, next) => updateSectionItem(s.key, idx, next)}
            onMarkAllYes={() => markAllYesSection(s.key, s.items.length)}
          />
        ))}
      </div>

      <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-white">Villa Check</h3>
      <div className="flex flex-col gap-2.5">
        {draft.villas.map((v, vIdx) => (
          <details key={vIdx} className="group rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 [&::-webkit-details-marker]:hidden group-open:rounded-b-none">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-slate-400 transition-transform group-open:rotate-90">
                <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 dark:text-white">Villa Check — {v.villaNumber || `Villa ${vIdx + 1}`}</span>
              <span
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); markAllYesVilla(vIdx, meta.villaItems.length); }}
                className="cursor-pointer whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              >
                Tick all Yes
              </span>
              <span className="whitespace-nowrap text-xs font-bold text-slate-400">
                {tally(v.items, meta.villaItems.length).answered}/{meta.villaItems.length}
              </span>
            </summary>
            <div className="border-t border-slate-200 p-3 dark:border-slate-700">
              <div className="mb-1 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Villa number, e.g. V21"
                  value={v.villaNumber}
                  onChange={(e) => setDraft((d) => ({ ...d, villas: d.villas.map((vv, i) => (i === vIdx ? { ...vv, villaNumber: e.target.value } : vv)) }))}
                  className="min-h-9 w-56 max-w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-base font-semibold focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                />
                {draft.villas.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, villas: d.villas.filter((_, i) => i !== vIdx) }))}
                    className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                  >
                    Remove villa
                  </button>
                )}
              </div>
              {meta.villaItems.map((label, idx) => (
                <ItemRow key={idx} label={label} itemState={v.items[idx]} onChange={(next) => updateVillaItem(vIdx, idx, next)} />
              ))}
            </div>
          </details>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setDraft((d) => ({ ...d, villas: [...d.villas, newVilla()] }))}
        className="inline-flex min-h-9 items-center gap-1.5 self-start rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <PlusIcon className="h-4 w-4" />
        Add another villa
      </button>

      <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-white">Guest Interaction</h3>
      <p className="-mt-2 text-xs text-slate-500 dark:text-slate-400">Meet and talk to at least 3 villas and note how their stay is going.</p>
      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {draft.guestInteractions.map((g, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
            <input
              type="text"
              placeholder="Villa & guest name(s)"
              value={g.villaGuest}
              onChange={(e) => setDraft((d) => ({ ...d, guestInteractions: d.guestInteractions.map((gg, gi) => (gi === i ? { ...gg, villaGuest: e.target.value } : gg)) }))}
              className="min-h-9 rounded-md border border-slate-300 px-2.5 py-1.5 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
            <input
              type="text"
              placeholder="Comment"
              value={g.comment}
              onChange={(e) => setDraft((d) => ({ ...d, guestInteractions: d.guestInteractions.map((gg, gi) => (gi === i ? { ...gg, comment: e.target.value } : gg)) }))}
              className="min-h-9 rounded-md border border-slate-300 px-2.5 py-1.5 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, guestInteractions: d.guestInteractions.filter((_, gi) => gi !== i) }))}
              className="justify-self-start rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
              aria-label="Remove row"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setDraft((d) => ({ ...d, guestInteractions: [...d.guestInteractions, newGuestRow()] }))}
        className="inline-flex min-h-9 items-center gap-1.5 self-start rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <PlusIcon className="h-4 w-4" />
        Add row
      </button>

      <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-white">Any Issue / Concern / Complaint</h3>
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        {draft.issues.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">No issues logged yet — add one below if something needs follow-up.</p>}
        {draft.issues.map((iss, i) => (
          <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_1fr]">
            <div className="relative flex h-36 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center text-xs text-slate-400 dark:border-slate-600 dark:bg-slate-800">
              {iss.photo ? (
                <>
                  <img src={iss.photo} alt="Issue" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, issues: d.issues.map((ii, ix) => (ix === i ? { ...ii, photo: '' } : ii)) }))}
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                </>
              ) : (
                <label className="flex h-full w-full cursor-pointer items-center justify-center p-2">
                  Tap to add photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    onChange={async (e) => {
                      const file = e.target.files && e.target.files[0];
                      if (!file) return;
                      const dataUrl = await compressImage(file).catch(() => '');
                      if (dataUrl) setDraft((d) => ({ ...d, issues: d.issues.map((ii, ix) => (ix === i ? { ...ii, photo: dataUrl } : ii)) }));
                    }}
                  />
                </label>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <textarea
                rows={2}
                placeholder="Describe the issue"
                value={iss.caption}
                onChange={(e) => setDraft((d) => ({ ...d, issues: d.issues.map((ii, ix) => (ix === i ? { ...ii, caption: e.target.value } : ii)) }))}
                className="rounded-md border border-slate-300 px-2.5 py-1.5 text-base focus:border-lagoon-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              />
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, issues: d.issues.filter((_, ix) => ix !== i) }))}
                className="self-start text-xs font-medium text-red-600 hover:underline dark:text-red-400"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setDraft((d) => ({ ...d, issues: [...d.issues, newIssue()] }))}
        className="inline-flex min-h-9 items-center gap-1.5 self-start rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <PlusIcon className="h-4 w-4" />
        Add issue with photo
      </button>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <Field label="Signature">
          <input type="text" value={draft.signature} onChange={(e) => setDraft((d) => ({ ...d, signature: e.target.value }))} placeholder="Type your name to sign off" className={inputClass} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-lagoon-600 px-5 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-60"
        >
          <CheckCircleIcon className="h-4 w-4" />
          {submitting ? 'Saving…' : editingId ? 'Save changes' : 'Submit checklist'}
        </button>
        {editingId && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel edit
          </button>
        )}
      </div>
    </form>
  );
}

function DetailRow({ label, itemState }) {
  const value = (itemState && itemState.value) || null;
  const tag =
    value === 'yes'
      ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold uppercase text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Yes</span>
      : value === 'no'
        ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold uppercase text-red-700 dark:bg-red-900/40 dark:text-red-300">No</span>
        : value === 'na'
          ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold uppercase text-slate-700 dark:bg-slate-700 dark:text-slate-200">N/A</span>
          : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold uppercase text-slate-400 dark:bg-slate-800">—</span>;
  return (
    <div className="flex items-start justify-between gap-3 border-t border-slate-100 px-4 py-2.5 first:border-t-0 dark:border-slate-800">
      <div className="text-sm text-slate-700 dark:text-slate-300">
        {label}
        {itemState && itemState.comment && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{itemState.comment}</div>}
      </div>
      {tag}
    </div>
  );
}

function ReportDetail({ report, meta, onBack, onEdit, onDownload, onDelete, downloading, deleting }) {
  let yes = 0, no = 0, answered = 0, total = 0;
  meta.sections.forEach((s) => {
    const st = tally(report.sections[s.key], s.items.length);
    yes += st.yes; no += st.no; answered += st.answered; total += st.total;
  });
  (report.villas || []).forEach((v) => {
    const st = tally(v.items, meta.villaItems.length);
    yes += st.yes; no += st.no; answered += st.answered; total += st.total;
  });
  const guests = (report.guestInteractions || []).filter((g) => g.villaGuest || g.comment);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
        <button onClick={onBack} className="min-h-9 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
          ← Back to reports
        </button>
        <div className="ml-auto flex flex-wrap gap-2">
          <IconActionButton icon={PencilIcon} tone="slate" onClick={onEdit} title="Edit" label="Edit report" />
          <IconActionButton icon={DownloadIcon} tone="lagoon" onClick={onDownload} disabled={downloading} spinning={downloading} title="Download PDF" label="Download PDF" />
          <IconActionButton icon={TrashIcon} tone="red" onClick={onDelete} disabled={deleting} title="Delete" label="Delete report" />
        </div>
      </div>
      <div className="p-4">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">{report.mod_name || 'Unnamed MOD'}</h2>
        <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Submitted {timeAgo(report.submitted_at)}
          {report.edited_at && <> · Edited {timeAgo(report.edited_at)}</>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <div className="text-xs uppercase text-slate-400">Date</div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">{report.report_date}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-400">Weather</div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">{report.weather || '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-400">Items checked</div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">{answered} / {total}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-400">Yes / No</div>
            <div className="text-sm font-medium">
              <span className="text-emerald-600 dark:text-emerald-400">{yes}</span> / <span className="text-red-600 dark:text-red-400">{no}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 p-4 pt-0">
        {meta.sections.map((s) => (
          <details key={s.key} className="rounded-lg border border-slate-200 dark:border-slate-700">
            <summary className="min-h-10 cursor-pointer list-none rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 [&::-webkit-details-marker]:hidden dark:bg-slate-800 dark:text-white">
              {s.title}
            </summary>
            <div>{s.items.map((label, idx) => <DetailRow key={idx} label={label} itemState={report.sections[s.key] && report.sections[s.key][idx]} />)}</div>
          </details>
        ))}
        {(report.villas || []).map((v, i) => (
          <details key={i} className="rounded-lg border border-slate-200 dark:border-slate-700">
            <summary className="min-h-10 cursor-pointer list-none rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 [&::-webkit-details-marker]:hidden dark:bg-slate-800 dark:text-white">
              Villa Check — {v.villaNumber || `Villa ${i + 1}`}
            </summary>
            <div>{meta.villaItems.map((label, idx) => <DetailRow key={idx} label={label} itemState={v.items && v.items[idx]} />)}</div>
          </details>
        ))}
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="mb-1 text-sm font-semibold text-slate-900 dark:text-white">Guest Interaction</div>
          {guests.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No guest interactions recorded.</p>
          ) : (
            guests.map((g, i) => (
              <div key={i} className="border-t border-slate-100 py-1.5 text-sm first:border-t-0 dark:border-slate-800">
                <strong className="text-slate-900 dark:text-white">{g.villaGuest || '—'}</strong>
                {g.comment && <div className="text-slate-500 dark:text-slate-400">{g.comment}</div>}
              </div>
            ))
          )}
        </div>
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Issues & Photos</div>
          {(report.issues || []).length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No issues logged.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {report.issues.map((iss, i) => (
                <figure key={i} className="w-52 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                  {iss.photo && <img src={iss.photo} alt="" className="aspect-[4/3] w-full object-cover" />}
                  {iss.caption && <figcaption className="px-2.5 py-2 text-xs text-slate-600 dark:text-slate-300">{iss.caption}</figcaption>}
                </figure>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
          <span className="font-semibold text-slate-900 dark:text-white">Signature: </span>
          <span className="text-slate-700 dark:text-slate-300">{report.signature || '—'}</span>
        </div>
      </div>
    </div>
  );
}

export default function MODReport() {
  const { token, isSuperAdmin } = useAuth();
  const { confirm, confirmDialog } = useConfirm();

  const [tab, setTab] = useState('new');
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState('');
  const [draft, setDraft] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [reports, setReports] = useState(null);
  const [pageInfo, setPageInfo] = useState(null);
  const [page, setPage] = useState(1);
  const [listError, setListError] = useState('');
  const [openReportId, setOpenReportId] = useState(null);
  const [openReport, setOpenReport] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [modSettings, setModSettings] = useState(null);
  const [modSettingsError, setModSettingsError] = useState('');
  const [modSettingsSuccess, setModSettingsSuccess] = useState(false);
  const [modSettingsSubmitting, setModSettingsSubmitting] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    api.modReports
      .meta(token)
      .then((res) => {
        setMeta(res);
        setDraft(newDraft(res.sections));
      })
      .catch((err) => setMetaError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isSuperAdmin]);

  function loadReports() {
    api.modReports
      .list(token, page)
      .then((res) => {
        setReports(res.reports);
        setPageInfo(res);
      })
      .catch((err) => setListError(err.message));
  }

  useEffect(() => {
    if (!isSuperAdmin || tab !== 'log') return;
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isSuperAdmin, tab, page]);

  useEffect(() => {
    if (!openReportId) { setOpenReport(null); return; }
    api.modReports
      .get(openReportId, token)
      .then((res) => setOpenReport(res.report))
      .catch((err) => setListError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openReportId]);

  useEffect(() => {
    if (!isSuperAdmin || tab !== 'settings') return;
    setModSettingsSuccess(false);
    api.modReports
      .getSettings(token)
      .then((res) => setModSettings(res.settings))
      .catch((err) => setModSettingsError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isSuperAdmin, tab]);

  if (!isSuperAdmin) {
    return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">You don't have permission to view this page.</div>;
  }

  async function handleSubmit() {
    if (!draft.mod_name.trim()) {
      setFormError('Please enter the MOD name before submitting.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      if (editingId) {
        const res = await api.modReports.update(editingId, draft, token);
        setEditingId(null);
        setDraft(newDraft(meta.sections));
        setTab('log');
        // setOpenReportId(res.report.id) alone would be a no-op here (it's
        // already that id, since editing always starts from the detail
        // view) — the [openReportId] effect below wouldn't re-fire, leaving
        // the detail view showing stale pre-edit data. Set openReport
        // directly from the update response instead.
        setOpenReportId(res.report.id);
        setOpenReport(res.report);
        loadReports();
      } else {
        await api.modReports.create(draft, token);
        setDraft(newDraft(meta.sections));
        setTab('log');
        setPage(1);
        setOpenReportId(null);
      }
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(report) {
    setDraft(draftFromReport(report, meta.sections));
    setEditingId(report.id);
    setFormError('');
    setTab('new');
  }

  async function cancelEdit() {
    if (!(await confirm({ title: 'Discard your changes to this report?', message: 'It will stay exactly as it was.', confirmLabel: 'Discard changes' }))) return;
    setEditingId(null);
    setDraft(newDraft(meta.sections));
    setFormError('');
  }

  async function handleDownload(id) {
    setDownloading(true);
    try {
      await api.modReports.openPdf(id, token);
    } catch (err) {
      setListError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete(id) {
    if (!(await confirm({ title: 'Delete this report?', message: 'This cannot be undone.', confirmLabel: 'Delete' }))) return;
    setDeletingId(id);
    try {
      await api.modReports.remove(id, token);
      setOpenReportId(null);
      loadReports();
    } catch (err) {
      setListError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSaveModSettings() {
    setModSettingsSubmitting(true);
    setModSettingsError('');
    setModSettingsSuccess(false);
    try {
      const res = await api.modReports.updateSettings(modSettings, token);
      setModSettings(res.settings);
      setModSettingsSuccess(true);
    } catch (err) {
      setModSettingsError(err.message);
    } finally {
      setModSettingsSubmitting(false);
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Manager on Duty Checklist</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Shift handover checklist for resort operations. Super admin only.
      </p>

      <div className="mt-6 inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
        {[
          { key: 'new', label: 'New checklist' },
          { key: 'log', label: `Reports${pageInfo ? ` (${pageInfo.total})` : ''}` },
          { key: 'settings', label: 'Settings' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setOpenReportId(null); }}
            className={`min-h-9 rounded-md px-4 text-sm font-medium ${tab === t.key ? 'bg-lagoon-600 text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {metaError && <p className="text-sm text-red-600 dark:text-red-400">{metaError}</p>}

        {tab === 'new' && meta && draft && (
          <ChecklistForm meta={meta} draft={draft} setDraft={setDraft} editingId={editingId} onSubmit={handleSubmit} onCancelEdit={cancelEdit} submitting={submitting} error={formError} />
        )}

        {tab === 'log' && (
          <>
            {listError && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{listError}</p>}
            {openReportId && openReport && meta ? (
              <ReportDetail
                report={openReport}
                meta={meta}
                onBack={() => setOpenReportId(null)}
                onEdit={() => startEdit(openReport)}
                onDownload={() => handleDownload(openReport.id)}
                onDelete={() => handleDelete(openReport.id)}
                downloading={downloading}
                deleting={deletingId === openReport.id}
              />
            ) : (
              <>
                {reports === null ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
                ) : reports.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    Fill out the checklist under "New checklist" to create your first report.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {reports.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setOpenReportId(r.id)}
                        className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-lagoon-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-lagoon-700"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-slate-900 dark:text-white">{r.mod_name || 'Unnamed MOD'}</div>
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {r.report_date}
                            {r.time_started && ` · started ${r.time_started}`}
                            {r.weather && ` · ${r.weather}`}
                            {r.edited_at && <span className="text-amber-600 dark:text-amber-400"> · edited</span>}
                          </div>
                        </div>
                        {r.photo_count > 0 && (
                          <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {r.photo_count} photo{r.photo_count === 1 ? '' : 's'}
                          </span>
                        )}
                        <div className="text-right">
                          <div className="text-lg font-bold text-slate-900 dark:text-white">{r.tally.score === null ? '—' : `${r.tally.score}%`}</div>
                          <div className="text-xs uppercase text-slate-400">yes rate</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {pageInfo && <Pagination page={pageInfo.page} totalPages={pageInfo.totalPages} onChange={setPage} />}
              </>
            )}
          </>
        )}

        {tab === 'settings' && (
          modSettings ? (
            <ModSettingsForm
              settings={modSettings}
              setSettings={setModSettings}
              onSubmit={handleSaveModSettings}
              submitting={modSettingsSubmitting}
              error={modSettingsError}
              setError={setModSettingsError}
              success={modSettingsSuccess}
            />
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">{modSettingsError || 'Loading…'}</p>
          )
        )}
      </div>

      {confirmDialog}
    </div>
  );
}
