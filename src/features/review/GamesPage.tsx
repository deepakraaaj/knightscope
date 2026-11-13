import { Card, PageHeader } from '@/components/ui';
import { GameTable } from '@/features/import/GameTable';
import { QueuePanel } from '@/features/import/QueuePanel';
import { Link } from 'react-router-dom';

export function GamesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Game review"
        description="Open a reviewed game to step through every move, see where the evaluation changed, and compare your choices with the engine's."
        actions={<Link to="/import" className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover">Import games</Link>}
      />
      <QueuePanel />
      <Card title="Games">
        <GameTable initialFilter="reviewed" />
      </Card>
    </div>
  );
}
