import { Ban, Castle, CircleDollarSign, Crown, Crosshair, Footprints, GitFork, HelpCircle, Pin, ShieldAlert, ShieldOff, Swords, TrendingDown, type LucideIcon } from 'lucide-react';
import type { MistakeCategory } from '@/types';
import type { PieceName } from '@/components/ui';

/** Icon, piece artwork and a plain-language description for each mistake category. */
export const CATEGORY_INFO: Record<MistakeCategory, { icon: LucideIcon; piece: PieceName; color: string; plain: string }> = {
  'hanging-piece': { icon: CircleDollarSign, piece: 'knight', color: '#F87171', plain: 'You left a piece where your opponent could take it for free.' },
  'missed-fork': { icon: GitFork, piece: 'knight', color: '#60A5FA', plain: 'One of your pieces could have attacked two enemy pieces at once.' },
  'missed-pin': { icon: Pin, piece: 'bishop', color: '#60A5FA', plain: 'You could have pinned a piece so it could not move without losing something bigger.' },
  'missed-skewer': { icon: Crosshair, piece: 'rook', color: '#60A5FA', plain: 'You could have attacked a big piece that had to move, winning the piece behind it.' },
  'missed-checkmate': { icon: Crown, piece: 'queen', color: '#2DD4BF', plain: 'A forced checkmate was available and you played something else.' },
  'missed-tactical-defense': { icon: ShieldOff, piece: 'bishop', color: '#FB923C', plain: 'Your move allowed a fork, pin, skewer or discovered attack against you.' },
  'back-rank-weakness': { icon: Castle, piece: 'rook', color: '#F87171', plain: 'Your king was trapped on the back rank behind its own pawns and could be mated.' },
  'queen-exposure': { icon: Ban, piece: 'queen', color: '#FB923C', plain: 'Your queen moved to a square where it got attacked and you lost material.' },
  'material-loss': { icon: TrendingDown, piece: 'pawn', color: '#FB923C', plain: 'The move lost material in the engine’s best line.' },
  'endgame-conversion': { icon: Swords, piece: 'king', color: '#FACC15', plain: 'You were winning the endgame and the move threw much of that advantage away.' },
  'king-safety': { icon: ShieldAlert, piece: 'king', color: '#F87171', plain: 'Your move let the opponent force checkmate.' },
  'opening-development': { icon: Footprints, piece: 'pawn', color: '#FACC15', plain: 'In the opening, bringing out a new piece or castling was better.' },
  other: { icon: HelpCircle, piece: 'pawn', color: '#94A3B8', plain: 'The engine found a better move, but no clear tactical pattern was confirmed.' },
};
