import { ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, CornerUpLeft, CornerUpRight, Flag, Merge, Navigation2, RotateCcw, RotateCw, Ship, Undo2, Redo2 } from 'lucide-react';

/** Icon for a Valhalla maneuver type. */
export function ManeuverIcon({ type, size = 44 }: { type: number | undefined; size?: number }) {
  const props = { size, strokeWidth: 2.4, 'aria-hidden': true };
  switch (type) {
    case 1: case 2: case 3: return <Navigation2 {...props} />;
    case 4: case 5: case 6: return <Flag {...props} />;
    case 9: case 18: case 20: case 23: case 37: return <ArrowUpRight {...props} />;
    case 16: case 19: case 21: case 24: case 38: return <ArrowUpLeft {...props} />;
    case 10: return <CornerUpRight {...props} />;
    case 15: return <CornerUpLeft {...props} />;
    case 11: return <ArrowRight {...props} />;
    case 14: return <ArrowLeft {...props} />;
    case 12: return <Redo2 {...props} />;
    case 13: return <Undo2 {...props} />;
    case 25: return <Merge {...props} />;
    case 26: return <RotateCcw {...props} />;
    case 27: return <RotateCw {...props} />;
    case 28: case 29: return <Ship {...props} />;
    default: return <ArrowUp {...props} />;
  }
}
