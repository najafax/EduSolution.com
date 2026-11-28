import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';

// Reached from the link at the bottom of sale emails. One click opts the client out.
export default function Unsubscribe() {
  const [params] = useSearchParams();
  const c = params.get('c');
  const t = params.get('t');
  const [state, setState] = useState('ask');
  const [error, setError] = useState('');

  async function go(undo) {
    setError('');
    try {
      await api.shopUnsubscribe({ c, t, undo });
      setState(undo ? 'ask' : 'done');
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">Sale emails</h1>
      {state === 'done' ? (
        <>
          <p className="mt-3 text-slate-600 dark:text-slate-300">You will no longer receive sale emails from Edu Solutions. Invoices and quotes are not affected.</p>
          <button type="button" onClick={() => go(true)} className="mt-6 text-sm underline text-slate-500">Changed your mind? Subscribe again</button>
        </>
      ) : (
        <>
          <p className="mt-3 text-slate-600 dark:text-slate-300">Stop receiving sale and promotion emails from Edu Solutions?</p>
          <button type="button" onClick={() => go(false)} disabled={!c || !t} className="mt-6 rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white disabled:opacity-50 dark:bg-lagoon-600">Unsubscribe</button>
        </>
      )}
      {error && <p className="mt-4 text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}
