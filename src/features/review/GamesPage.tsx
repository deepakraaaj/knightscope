import { Card, PageHeader } from '@/components/ui';
import { BookOpenCheck, Library } from 'lucide-react';
import { GameTable } from '@/features/import/GameTable';
import { QueuePanel } from '@/features/import/QueuePanel';
import { Link } from 'react-router-dom';

export function GamesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={BookOpenCheck}
        steps={['Open a reviewed game', 'Click a red or orange move', 'Press “Why not my move?”', 'Retry it or add it to training']}
        title="Game review"
        description="Open a reviewed game to step through every move, see where the evaluation changed, and compare your choices with the engine's."
        actions={<Link to="/import" className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover">Import games</Link>}
      />
      <QueuePanel />
      <Card icon={Library} title="Games" hint="Reviewed games open with move-by-move feedback; others can be analyzed here">
        <GameTable initialFilter="reviewed" />
      </Card>
    </div>
  );
}
