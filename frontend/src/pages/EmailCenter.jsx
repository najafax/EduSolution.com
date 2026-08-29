import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import Pagination from '../components/Pagination';

// One editable card per template type — subject/message text fields (kept
// as local draft state until "Save"), a placeholder reference list, and a
// "Reset to default" action shown only when this type actually has a
// stored override (template.isCustom). Saving/resetting both re-fetch the
// full template list from the parent so `isCustom`/defaults stay accurate
// without duplicating that logic here.
function TemplateCard({ template, token, onChanged, canManage }) {
  const [subject, setSubject] = useState(template.subject);
  const [message, setMessage] = useState(template.message);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSubject(template.subject);
    setMessage(template.message);
    setSaved(false);
  }, [template.subject, template.message]);

  const dirty = subject !== template.subject || message !== template.message;

  async function handleSave() {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await api.emailCenter.updateTemplate(template.type, { subject, message }, token);
      setSaved(true);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await api.emailCenter.resetTemplate(template.type, token);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{template.label}</h3>
        {template.isCustom && (
          <span className="rounded-full bg-lagoon-100 px-2 py-0.5 text-xs font-medium text-lagoon-700 dark:bg-lagoon-950 dark:text-lagoon-400">
            Customized
          </span>
        )}
      </div>

      <label className="mt-3 block">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Subject</span>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          readOnly={!canManage}
          className={`mt-1 min-h-11 w-full rounded-md border px-3 py-2 text-base focus:outline-none ${
            canManage
              ? 'border-slate-300 focus:border-lagoon-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white'
              : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
          }`}
        />
      </label>

      <label className="mt-3 block">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Message</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          readOnly={!canManage}
          className={`mt-1 w-full rounded-md border px-3 py-2 text-base focus:outline-none ${
            canManage
              ? 'border-slate-300 focus:border-lagoon-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white'
              : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
          }`}
        />
      </label>

      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Placeholders:{' '}
        {template.placeholders.map((p, i) => (
          <span key={p.key}>
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono dark:bg-slate-800">{`{{${p.key}}}`}</code>
            {' '}({p.label}){i < template.placeholders.length - 1 ? ', ' : ''}
          </span>
        ))}
      </p>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {saved && !dirty && <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">Saved.</p>}

      {canManage && (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={!dirty || busy}
            className="min-h-11 rounded-md bg-lagoon-600 px-4 text-sm font-medium text-white hover:bg-lagoon-500 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          {template.isCustom && (
            <button
              onClick={handleReset}
              disabled={busy}
              className="min-h-11 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Reset to default
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SentLog({ token }) {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.emailCenter
      .log(token, page)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, page]);

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      {error && <p className="p-6 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!error && loading ? (
        <p className="p-6 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : !error && (!data || data.entries.length === 0) ? (
        <p className="p-6 text-sm text-slate-500 dark:text-slate-400">No emails have been sent yet.</p>
      ) : !error ? (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm sm:px-6">
              <span className="text-slate-700 dark:text-slate-300">
                <span className="font-medium text-slate-900 dark:text-white">{entry.type_label}</span>{' '}
                to <span className="text-slate-900 dark:text-white">{entry.to_email}</span>
                {entry.entity_label ? <span className="text-slate-500 dark:text-slate-400"> — {entry.entity_label}</span> : null}
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  "{entry.subject}"{entry.sent_by_name ? ` — sent by ${entry.sent_by_name}` : ''}
                </span>
              </span>
              <span className="whitespace-nowrap text-xs text-slate-400 dark:text-slate-500">
                {new Date(entry.created_at.replace(' ', 'T') + 'Z').toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {data && (
        <div className="px-4 pb-4 sm:px-6">
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </div>
      )}
    </div>
  );
}

export default function EmailCenter() {
  const { token, can } = useAuth();
  const canView = can('email_center', 'view');
  const canManage = can('email_center', 'manage');
  const [templates, setTemplates] = useState(null);
  const [error, setError] = useState('');

  function loadTemplates() {
    return api.emailCenter
      .templates(token)
      .then((res) => setTemplates(res.templates))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (canView) loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, canView]);

  if (!canView) {
    return <div className="px-4 py-10 text-sm text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">You don't have permission to view this page.</div>;
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Email center</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        {canManage
          ? "Customize the default subject/message for every client-facing email, and see a record of what's actually been sent."
          : "See the default subject/message for every client-facing email, and a record of what's actually been sent."}
      </p>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <h2 className="mt-8 text-lg font-semibold text-slate-900 dark:text-white">Templates</h2>
      {templates ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {templates.map((t) => (
            <TemplateCard key={t.type} template={t} token={token} onChanged={loadTemplates} canManage={canManage} />
          ))}
        </div>
      ) : (
        !error && <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      )}

      <h2 className="mt-10 text-lg font-semibold text-slate-900 dark:text-white">Sent log</h2>
      <SentLog token={token} />
    </div>
  );
}
