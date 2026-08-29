import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { ChecklistForm, newDraft } from './business/MODReport';
import { CheckCircleIcon } from '../components/icons';

// The public counterpart to pages/business/MODReport.jsx's own "New
// checklist" tab — reuses that same ChecklistForm/newDraft (exported from
// there for exactly this reuse) so the two create-flows can never drift
// apart in shape. Unlike PublicQuote.jsx/PublicInvoice.jsx, there's
// nothing to *read* here — a public submission link only ever creates a
// new report (see routes/public.js's own note on why), so this page never
// fetches or shows any existing report data, past or present.
export default function PublicMODReport() {
  const { token } = useParams();
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState('');
  const [draft, setDraft] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    api.public
      .modReportMeta(token)
      .then((res) => {
        setMeta(res);
        setDraft(newDraft(res.sections));
      })
      .catch((err) => setMetaError(err.message));
  }, [token]);

  async function handleSubmit() {
    if (!draft.mod_name.trim()) {
      setFormError('Please enter the MOD name before submitting.');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await api.public.submitModReport(token, draft);
      setSubmitted(true);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function submitAnother() {
    setDraft(newDraft(meta.sections));
    setSubmitted(false);
  }

  if (metaError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <p className="text-sm text-red-600 dark:text-red-400">{metaError}</p>
      </div>
    );
  }

  if (!meta || !draft) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm text-slate-500 dark:text-slate-400 sm:px-6">Loading…</div>;
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
          <CheckCircleIcon className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">Checklist submitted</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Thanks{draft.mod_name ? `, ${draft.mod_name}` : ''} — your MOD report has been recorded.
        </p>
        <button
          type="button"
          onClick={submitAnother}
          className="mt-6 inline-flex min-h-11 items-center rounded-md bg-lagoon-600 px-5 text-sm font-medium text-white hover:bg-lagoon-500"
        >
          Submit another checklist
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        {meta.logoImage && <img src={meta.logoImage} alt="" className="h-10 w-10 rounded-md object-contain" />}
        <div>
          {/* Only shown when actually set — with no business name configured
              this would otherwise just repeat the H1 right below it. */}
          {meta.businessName && <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{meta.businessName}</p>}
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Manager on Duty Checklist</h1>
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Shift handover checklist for resort operations. Submitting here doesn't require an account.
      </p>

      <div className="mt-6">
        <ChecklistForm
          meta={meta}
          draft={draft}
          setDraft={setDraft}
          editingId={null}
          onSubmit={handleSubmit}
          onCancelEdit={() => {}}
          submitting={submitting}
          error={formError}
        />
      </div>
    </div>
  );
}
