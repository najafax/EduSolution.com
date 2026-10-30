import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { todayStr } from '../../lib/date';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../lib/useConfirm';
import Modal from '../../components/Modal';
import { Btn, Card, Chips, Detail, Empty, Field, FormModal, INPUT, Row, full, n2, useLoader, useSymbol } from './ui';

// Equity: the owners' side of the money. People (ownership %), draws and
// their returns, contributions, and the automatic profit sharing.

const SECTIONS = [['people', 'People'], ['draws', 'Draws'], ['contrib', 'Contributions'], ['profit', 'Profit sharing']];

function Stat({ label, value, sub }) {
  return (
    <div className="min-w-0 rounded-3xl bg-white p-4 dark:border dark:border-slate-700 dark:bg-slate-900">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 truncate font-display text-xl font-extrabold tabular-nums text-slate-900 dark:text-white">{value}</p>
      {sub && <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
}

export default function EquityTab({ token, can, entry, clearEntry }) {
  const symbol = useSymbol(token);
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const canManage = can('financials', 'manage');
  const [section, setSection] = useState('people');
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(null); // { kind: 'person'|'draw'|'return'|'contrib', ... }
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const { data: sh, reload: reloadSh } = useLoader(() => api.shareholders.list(token), [token]);
  const { data: ds, reload: reloadDs } = useLoader(() => api.ownerDraws.summary(token), [token]);
  const { data: draws, reload: reloadDraws } = useLoader(() => api.ownerDraws.list(token), [token]);
  const { data: cc, reload: reloadCc } = useLoader(() => api.capitalContributions.list(token), [token]);
  const { data: sum, reload: reloadSum } = useLoader(() => api.financials.summary(token), [token]);
  const { data: auto, reload: reloadAuto } = useLoader(() => api.deals.autoSettings(token), [token]);
  const { data: deals, reload: reloadDeals } = useLoader(() => api.deals.list(token, { status: 'distributed' }), [token]);
  const reloadAll = () => (reloadSh(), reloadDs(), reloadDraws(), reloadCc(), reloadSum(), reloadAuto(), reloadDeals());

  useEffect(() => {
    if (entry === 'contribution') {
      setSection('contrib');
      setForm({ kind: 'contrib', contributor_name: '', amount: '', contribution_date: todayStr(), notes: '' });
      setFormError('');
      clearEntry();
    } else if (entry === 'draw') {
      setSection('draws');
      setForm({ kind: 'draw', taken_by_name: '', amount: '', draw_date: todayStr(), notes: '' });
      setFormError('');
      clearEntry();
    }
  }, [entry, clearEntry]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const open = (kind, init) => (setForm({ kind, ...init }), setFormError(''));

  async function submit() {
    setBusy(true);
    setFormError('');
    try {
      const f = form;
      const amount = Number(f.amount);
      if (f.kind === 'person') {
        const body = { name: f.name, email: f.email, ownership_percent: Number(f.ownership_percent) || 0, active: f.active ? 1 : 0 };
        if (f.id) await api.shareholders.update(f.id, body, token);
        else await api.shareholders.create(body, token);
      } else if (f.kind === 'draw') {
        const body = { type: 'draw', taken_by_name: f.taken_by_name, amount, draw_date: f.draw_date, notes: f.notes };
        if (f.id) await api.ownerDraws.update(f.id, body, token);
        else await api.ownerDraws.create(body, token);
      } else if (f.kind === 'return') {
        await api.ownerDraws.recordReturn(f.drawId, { amount, draw_date: f.draw_date, notes: f.notes }, token);
      } else {
        const body = { contributor_name: f.contributor_name, amount, contribution_date: f.contribution_date, notes: f.notes };
        if (f.id) await api.capitalContributions.update(f.id, body, token);
        else await api.capitalContributions.create(body, token);
      }
      toast('Saved.', { type: 'success' });
      setForm(null);
      reloadAll();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(label, fn) {
    if (!(await confirm({ title: `Delete ${label}?`, confirmLabel: 'Delete' }))) return;
    try {
      await fn();
      toast('Deleted.', { type: 'success' });
      reloadAll();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  const people = sh?.shareholders || [];
  const assigned = people.filter((p) => p.active).reduce((s, p) => s + (p.ownership_percent || 0), 0);
  const byName = new Map((ds?.byName || []).map((b) => [b.name.toLowerCase(), b]));
  const formTitle = { person: 'Shareholder', draw: 'Owner draw', return: 'Record a return', contrib: 'Owner contribution' }[form?.kind] || '';

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Profit paid out" value={sum ? full(symbol, sum.totalOwnerDistributions) : '…'} sub="All time" />
        <Stat label="Draws still owed" value={ds ? full(symbol, ds.outstandingBalance) : '…'} sub="Taken minus returned" />
        <Stat label="Contributions" value={sum ? full(symbol, sum.totalCapitalContributions) : '…'} sub="All time" />
        <Stat label="Ownership assigned" value={`${n2(assigned)}%`} sub={`${n2(Math.max(100 - assigned, 0))}% stays in the business`} />
      </div>

      <Chips options={SECTIONS} value={section} onChange={(s) => (setSection(s), setOpenId(null))} />

      {section === 'people' && (
        <Card title="Shareholders" action={canManage && <Btn tone="primary" onClick={() => open('person', { name: '', email: '', ownership_percent: '', active: true })}>+ Shareholder</Btn>}>
          {people.length === 0 ? <Empty>No shareholders yet.</Empty> : people.map((p) => {
            const b = byName.get(p.name.toLowerCase());
            return (
              <Row key={p.id} title={p.name} sub={p.email} amount={`${n2(p.ownership_percent || 0)}%`} tag={p.active ? (b && b.outstanding > 0 ? 'Owes a draw' : 'Active') : 'Inactive'} tone={p.active ? (b && b.outstanding > 0 ? 'warn' : 'pos') : 'neu'} open={openId === `p${p.id}`} onClick={() => setOpenId(openId === `p${p.id}` ? null : `p${p.id}`)}>
                <Detail pairs={[['Draws taken', full(symbol, b?.totalDraws || 0)], ['Returned', full(symbol, b?.totalReturns || 0)], ['Owes the business', full(symbol, b?.outstanding || 0)]]}>
                  {canManage && <Btn onClick={() => open('person', { ...p, active: Boolean(p.active), ownership_percent: String(p.ownership_percent ?? '') })}>Edit</Btn>}
                  {canManage && <Btn onClick={() => open('draw', { taken_by_name: p.name, amount: '', draw_date: todayStr(), notes: '' })}>Record draw</Btn>}
                  <Btn onClick={() => api.ownerDraws.statementPdf(p.name, token).catch((e) => toast(e.message, { type: 'error' }))}>Statement</Btn>
                  {canManage && <Btn tone="danger" onClick={() => remove(p.name, () => api.shareholders.remove(p.id, token))}>Delete</Btn>}
                </Detail>
              </Row>
            );
          })}
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Active ownership may not add up to more than 100%. Whatever is not assigned stays in the business.</p>
        </Card>
      )}

      {section === 'draws' && (
        <Card title="Owner draws" action={canManage && <Btn tone="primary" onClick={() => open('draw', { taken_by_name: '', amount: '', draw_date: todayStr(), notes: '' })}>+ Draw</Btn>}>
          {!draws ? <Empty>Loading…</Empty> : draws.draws.length === 0 ? <Empty>No draws or returns yet.</Empty> : draws.draws.map((d) => (
            <Row key={d.id} title={`${d.type === 'draw' ? 'Draw' : 'Return'} · ${d.taken_by_name}`} sub={`${d.draw_date}${d.notes ? ` · ${d.notes}` : ''}`} amount={`${d.type === 'draw' ? '−' : '+'}${full(symbol, d.amount)}`} tag={d.type === 'draw' ? (d.balance > 0 ? `${full(symbol, d.balance)} owed` : 'Repaid') : 'Return'} tone={d.type === 'draw' ? (d.balance > 0 ? 'warn' : 'pos') : 'pos'} open={openId === `d${d.id}`} onClick={() => setOpenId(openId === `d${d.id}` ? null : `d${d.id}`)}>
              <Detail pairs={d.type === 'draw' ? [['Taken', full(symbol, d.amount)], ['Returned', full(symbol, d.returned_amount || 0)], ['Balance', full(symbol, d.balance || 0)]] : [['Amount', full(symbol, d.amount)], ['Date', d.draw_date]]}>
                {canManage && d.type === 'draw' && d.balance > 0 && <Btn tone="primary" onClick={() => open('return', { drawId: d.id, amount: String(d.balance), draw_date: todayStr(), notes: '', who: d.taken_by_name, max: d.balance })}>Record return</Btn>}
                {canManage && d.type === 'draw' && <Btn onClick={() => open('draw', { ...d, amount: String(d.amount) })}>Edit</Btn>}
                {canManage && <Btn tone="danger" onClick={() => remove('this entry', () => api.ownerDraws.remove(d.id, token))}>Delete</Btn>}
              </Detail>
            </Row>
          ))}
        </Card>
      )}

      {section === 'contrib' && (
        <Card title="Contributions" action={canManage && <Btn tone="primary" onClick={() => open('contrib', { contributor_name: '', amount: '', contribution_date: todayStr(), notes: '' })}>+ Contribution</Btn>}>
          {!cc ? <Empty>Loading…</Empty> : cc.contributions.length === 0 ? <Empty>No contributions yet.</Empty> : cc.contributions.map((c) => (
            <Row key={c.id} title={c.contributor_name} sub={`${c.contribution_date}${c.notes ? ` · ${c.notes}` : ''}`} amount={`+${full(symbol, c.amount)}`} open={openId === `c${c.id}`} onClick={() => setOpenId(openId === `c${c.id}` ? null : `c${c.id}`)}>
              <Detail pairs={[['Date', c.contribution_date], ['Notes', c.notes || '—']]}>
                {canManage && <Btn onClick={() => open('contrib', { ...c, amount: String(c.amount) })}>Edit</Btn>}
                {canManage && <Btn tone="danger" onClick={() => remove('this contribution', () => api.capitalContributions.remove(c.id, token))}>Delete</Btn>}
              </Detail>
            </Row>
          ))}
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Contributions add to the bank balance but are not profit.</p>
        </Card>
      )}

      {section === 'profit' && (
        <ProfitSharing token={token} symbol={symbol} canManage={canManage} auto={auto} deals={deals?.deals || []} reload={reloadAll} toast={toast} />
      )}

      <FormModal open={Boolean(form)} onClose={() => setForm(null)} title={form ? `${form.id ? 'Edit' : 'New'}: ${formTitle}` : ''} onSubmit={submit} busy={busy} error={formError}>
        {form?.kind === 'person' && (
          <>
            <Field label="Name"><input required className={INPUT} value={form.name} onChange={set('name')} /></Field>
            <Field label="Email (for the daily earnings report)"><input required type="email" className={INPUT} value={form.email} onChange={set('email')} /></Field>
            <Field label="Ownership (%)"><input type="number" min="0" max="100" step="0.01" className={INPUT} value={form.ownership_percent} onChange={set('ownership_percent')} /></Field>
            <label className="flex items-center gap-2 pt-6 text-sm dark:text-white"><input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} /> Active</label>
          </>
        )}
        {form && form.kind !== 'person' && (
          <>
            {form.kind === 'return' && <p className="text-sm text-slate-600 sm:col-span-2 dark:text-slate-300">Return from {form.who}. Up to {full(symbol, form.max)} is still owed.</p>}
            {form.kind === 'draw' && <Field label="Taken by"><input required className={INPUT} value={form.taken_by_name} onChange={set('taken_by_name')} list="owner-names" /></Field>}
            {form.kind === 'contrib' && <Field label="Contributor"><input required className={INPUT} value={form.contributor_name} onChange={set('contributor_name')} list="owner-names" /></Field>}
            <datalist id="owner-names">{people.map((p) => <option key={p.id} value={p.name} />)}</datalist>
            <Field label="Amount"><input required type="number" min="0" step="0.01" className={INPUT} value={form.amount} onChange={set('amount')} /></Field>
            <Field label="Date"><input required type="date" className={INPUT} value={form.kind === 'contrib' ? form.contribution_date : form.draw_date} onChange={set(form.kind === 'contrib' ? 'contribution_date' : 'draw_date')} /></Field>
            <Field label="Notes (optional)" className="sm:col-span-2"><input className={INPUT} value={form.notes || ''} onChange={set('notes')} /></Field>
          </>
        )}
      </FormModal>
      {confirmDialog}
    </div>
  );
}

function ProfitSharing({ token, symbol, canManage, auto, deals, reload, toast }) {
  const [plan, setPlan] = useState(null); // { deal, kind: 'rate'|'real', rate?, preview?, error? }
  const [busy, setBusy] = useState(false);

  async function toggle() {
    try {
      await api.deals.setAuto(!auto.enabled, token);
      toast(auto.enabled ? 'Automatic sharing is off.' : 'Automatic sharing is on.', { type: 'success' });
      reload();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }
  async function runNow() {
    try {
      const r = await api.deals.autoRun(token);
      toast(r.skipped ? `Nothing shared (${r.skipped === 'off' ? 'automatic sharing is off' : 'no active shareholder has an ownership %'}).` : `Shared ${r.distributed.length} sale(s).`, { type: 'success' });
      reload();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  function openPlan(deal, kind) {
    const p = { deal, kind, rate: auto?.usdAverageRate ? String(auto.usdAverageRate) : '', preview: null, error: '' };
    setPlan(p);
    if (kind === 'real') api.deals.realCostPreview(deal.id, token).then((pv) => setPlan((c) => c && { ...c, preview: pv })).catch((e) => setPlan((c) => c && { ...c, error: e.message }));
  }
  useEffect(() => {
    if (!plan || plan.kind !== 'rate' || !(Number(plan.rate) > 0)) return undefined;
    let dead = false;
    const t = setTimeout(() => {
      api.deals.trueUpPreview(plan.deal.id, plan.rate, token).then((pv) => !dead && setPlan((c) => c && { ...c, preview: pv, error: '' })).catch((e) => !dead && setPlan((c) => c && { ...c, preview: null, error: e.message }));
    }, 300);
    return () => { dead = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.rate, plan?.deal?.id, plan?.kind]);

  async function apply() {
    setBusy(true);
    try {
      if (plan.kind === 'rate') await api.deals.trueUp(plan.deal.id, Number(plan.rate), token);
      else await api.deals.trueUpReal(plan.deal.id, token);
      toast('Payout adjusted.', { type: 'success' });
      setPlan(null);
      reload();
    } catch (err) {
      setPlan((c) => ({ ...c, error: err.message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="Automatic sharing" action={canManage && auto && <div className="flex gap-2"><Btn onClick={toggle}>{auto.enabled ? 'Turn off' : 'Turn on'}</Btn>{auto.enabled && <Btn onClick={runNow}>Run now</Btn>}</div>}>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          {auto?.enabled ? <>On since <b>{auto.from}</b>. Each night, every invoice fully paid since then is shared between the active shareholders by ownership %.</> : 'Off. Turn it on to share profit automatically from today onward. Past invoices are never back-filled.'}
          {auto?.usdAverageRate ? ` USD account average rate today: ${n2(auto.usdAverageRate)}.` : ''}
        </p>
      </Card>
      <Card title="Shared sales">
        {deals.length === 0 ? <Empty>Nothing shared yet.</Empty> : deals.map((d) => (
          <Row key={d.id} title={d.description} sub={`Revenue ${full(symbol, d.revenue_amount)} · cost ${full(symbol, d.cost_mvr)}`} amount={full(symbol, d.net_profit)} tag={d.cost_is_real ? (d.cost_basis === 'actual' ? 'Real cost' : 'Invoiced cost') : 'Estimated cost'} tone={d.cost_basis === 'actual' ? 'pos' : 'warn'}>
            {canManage && (
              <div className="mb-3 flex flex-wrap gap-2">
                {d.real_cost && <Btn tone="primary" onClick={() => openPlan(d, 'real')}>Adjust to real cost</Btn>}
                {!d.cost_is_real && d.cost_usd_total > 0 && <Btn onClick={() => openPlan(d, 'rate')}>Adjust to actual rate</Btn>}
              </div>
            )}
          </Row>
        ))}
      </Card>

      <Modal open={Boolean(plan)} onClose={() => setPlan(null)} title={plan?.kind === 'real' ? 'Adjust to real cost' : 'Adjust to actual rate'}>
        {plan && (
          <div className="grid gap-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">{plan.deal.description}</p>
            {plan.kind === 'rate' && (
              <Field label="Actual rate (MVR per USD)"><input type="number" min="0" step="0.0001" className={INPUT} value={plan.rate} onChange={(e) => setPlan((c) => ({ ...c, rate: e.target.value }))} /></Field>
            )}
            {plan.error && <p className="text-sm text-red-600 dark:text-red-400">{plan.error}</p>}
            {plan.preview && (
              <div className="rounded-2xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                <p className="mb-1 text-slate-600 dark:text-slate-300">Net profit {full(symbol, plan.preview.oldNet)} → <b>{full(symbol, plan.preview.newNet)}</b></p>
                {plan.preview.rows.map((r) => (
                  <div key={r.name} className="flex justify-between"><span>{r.name}</span><span className="tabular-nums">{r.adjustment >= 0 ? '+' : '−'}{full(symbol, Math.abs(r.adjustment))}</span></div>
                ))}
                <p className="mt-1 text-xs text-slate-500">A negative figure means that person was overpaid.</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setPlan(null)}>Cancel</Btn>
              <Btn tone="primary" disabled={busy || !plan.preview} onClick={apply}>Apply adjustment</Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
