import { Children, Fragment, isValidElement, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import BottomSheet from './BottomSheet';

// Studio stage 3: a list row (or detail panel) shows ONE main action as a
// labelled button and tucks the rest behind a "more" menu, instead of a
// row of up to seven icon-only buttons. It is a drop-in wrapper: pages keep
// building their actions exactly as before (a fragment of conditional
// <IconActionButton>s, each already gated on permissions and row state) and
// pass them as children. This component only reads each element's props
// (icon, title, label, tone, onClick, disabled, spinning) — it never
// decides what a user may do, so the existing "never show a button that
// would just error" gating is untouched.
//
// Primary action: the first child whose title is in PRIMARY_TITLES (the
// most useful next step for a row), else the first child. With one action
// there is no menu; with `expanded`, every action renders as a labelled
// button (used by the desktop detail panel). The menu is a popover on wide
// screens and a bottom sheet on phones, both rendered through portals so a
// table's overflow-x-auto or a card's overflow-hidden can never clip them.
const PRIMARY_TITLES = [
  'Record payment',
  'Renew',
  'Create quote from this request',
  'Record return',
  'Distribute',
  'Adjust to real cost',
  'Publish',
  'Email to client',
  'Send reminder',
  'Invite to portal',
  'Edit',
];

function flatten(children) {
  const out = [];
  Children.toArray(children).forEach((child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) out.push(...flatten(child.props.children));
    else out.push(child);
  });
  return out;
}

const MoreIcon = () => (
  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <circle cx="4.5" cy="10" r="1.5" />
    <circle cx="10" cy="10" r="1.5" />
    <circle cx="15.5" cy="10" r="1.5" />
  </svg>
);

function labelOf(el) {
  return el.props.title || el.props.label || 'Action';
}

function PrimaryButton({ el, fill }) {
  const { icon: Icon, onClick, disabled, spinning, tone } = el.props;
  const danger = tone === 'red';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold disabled:pointer-events-none disabled:opacity-50 ${
        fill ? 'flex-1' : ''
      } ${
        danger
          ? 'bg-red-600 text-white hover:bg-red-500'
          : 'bg-slate-900 text-white hover:bg-slate-700 dark:bg-slate-900 dark:hover:bg-slate-700 dark:bg-lagoon-600 dark:hover:bg-lagoon-500'
      }`}
    >
      {Icon && <Icon width={16} height={16} className={spinning ? 'animate-spin' : ''} />}
      {labelOf(el)}
    </button>
  );
}

function SecondaryButton({ el }) {
  const { icon: Icon, onClick, disabled, spinning, tone } = el.props;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium disabled:pointer-events-none disabled:opacity-50 ${
        tone === 'red'
          ? 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950'
          : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
      }`}
    >
      {Icon && <Icon width={16} height={16} className={spinning ? 'animate-spin' : ''} />}
      {labelOf(el)}
    </button>
  );
}

function MenuItem({ el, onDone }) {
  const { icon: Icon, onClick, disabled, tone } = el.props;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onDone();
        onClick?.();
      }}
      className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium disabled:opacity-50 ${
        tone === 'red'
          ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50'
          : 'text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800'
      }`}
    >
      {Icon && <Icon width={17} height={17} className="shrink-0" />}
      {labelOf(el)}
    </button>
  );
}

export function MoreMenu({ items, large = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  function toggle() {
    if (open) return setOpen(false);
    const r = btnRef.current.getBoundingClientRect();
    const wide = window.innerWidth >= 640;
    if (wide) {
      const below = window.innerHeight - r.bottom;
      const needed = items.length * 44 + 16;
      setPos({
        right: Math.max(8, window.innerWidth - r.right),
        ...(below >= needed ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }),
      });
    } else {
      setPos(null);
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open || !pos) return;
    function away(e) {
      if (popRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function key(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    const close = () => setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, pos]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex ${large ? 'h-11 w-11' : 'h-10 w-10'} shrink-0 items-center justify-center rounded-xl border border-slate-400/70 bg-white/70 text-slate-800 shadow-sm hover:bg-white dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800`}
      >
        <MoreIcon />
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={popRef}
            role="menu"
            style={{ position: 'fixed', zIndex: 60, ...pos }}
            className="modal-panel w-56 rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-slate-900/10 dark:bg-slate-900 dark:ring-white/10"
          >
            {items.map((el, i) => (
              <MenuItem key={el.key ?? i} el={el} onDone={() => setOpen(false)} />
            ))}
          </div>,
          document.body,
        )}
      <BottomSheet open={open && !pos} onClose={() => setOpen(false)} title="Actions">
        <div className="flex flex-col gap-0.5">
          {items.map((el, i) => (
            <MenuItem key={el.key ?? i} el={el} onDone={() => setOpen(false)} />
          ))}
        </div>
      </BottomSheet>
    </>
  );
}

export default function RowActions({ children, expanded = false, fill = false, align = 'end' }) {
  const all = flatten(children);
  if (all.length === 0) return null;

  const wrap = `flex items-center gap-2 ${align === 'end' ? 'justify-end' : ''}`;

  if (expanded) {
    const primaryIdx = Math.max(0, all.findIndex((el) => PRIMARY_TITLES.includes(el.props.title)));
    return (
      <div className="flex flex-wrap gap-2">
        <PrimaryButton el={all[primaryIdx]} />
        {all.filter((_, i) => i !== primaryIdx).map((el, i) => (
          <SecondaryButton key={el.key ?? i} el={el} />
        ))}
      </div>
    );
  }

  let primaryIdx = all.findIndex((el) => PRIMARY_TITLES.includes(el.props.title));
  if (primaryIdx < 0) primaryIdx = 0;
  const primary = all[primaryIdx];
  const rest = all.filter((_, i) => i !== primaryIdx);

  return (
    <div className={wrap}>
      <PrimaryButton el={primary} fill={fill} />
      {rest.length > 0 && <MoreMenu items={rest} />}
    </div>
  );
}
