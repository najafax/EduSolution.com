import { useNavigate } from 'react-router-dom';
import { MoreMenu } from './RowActions';

// Studio stage 3: the secondary header actions of a list page (Analytics,
// Export CSV, Export Excel) live behind one "more" button so the header
// carries just the primary "New X" button on a phone instead of a wrapped
// stack of four. `items` are { label, icon, to? , onClick? }; a `to` item
// navigates, otherwise onClick runs. The handlers are the page's own
// existing ones (the exports still pass the current filters).
export default function PageMenu({ items }) {
  const navigate = useNavigate();
  const mapped = items.map((it) => ({
    key: it.label,
    props: { icon: it.icon, title: it.label, onClick: it.to ? () => navigate(it.to) : it.onClick },
  }));
  return <MoreMenu items={mapped} large />;
}
