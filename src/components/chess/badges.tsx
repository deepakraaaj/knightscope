import type { Classification, ConfidenceLabel } from '@/types';
import { CLASSIFICATION_META } from '@/chess/classification/classify';
import { CONFIDENCE_META } from '@/chess/classification/confidence';
import { Badge } from '@/components/ui';

export function ClassificationBadge({ c, short }: { c: Classification | null; short?: boolean }) {
  if (!c) return null;
  const m = CLASSIFICATION_META[c];
  return (
    <Badge color={m.color}>
      <span aria-hidden>{m.symbol}</span>
      {!short && m.label}
      {short && <span className="sr-only">{m.label}</span>}
    </Badge>
  );
}

const CONF_COLOR: Record<ConfidenceLabel, string> = { stable: '#4ADE80', preliminary: '#94A3B8', 'needs-deeper': '#FACC15', incomplete: '#F87171' };

export function ConfidenceBadge({ label }: { label: ConfidenceLabel | null | undefined }) {
  if (!label) return null;
  return (
    <span title={CONFIDENCE_META[label].description}>
      <Badge color={CONF_COLOR[label]}>{CONFIDENCE_META[label].label}</Badge>
    </span>
  );
}
