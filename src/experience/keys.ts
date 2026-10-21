export interface KeySpec {
  id: string;
  label: string;
  row: number;
  width: number; // in key units
  world?: string;
}

// width in units (1 = standard key)
export const KEY_ROWS: { keys: { label: string; width?: number; world?: string }[] }[] = [
  { keys: [
    { label: 'Esc', width: 1.5 },
    { label: 'F1' }, { label: 'F2' }, { label: 'F3' }, { label: 'F4' },
    { label: 'F5' }, { label: 'F6' }, { label: 'F7' }, { label: 'F8' },
    { label: 'F9' }, { label: 'F10' }, { label: 'F11' }, { label: 'F12' },
  ]},
  { keys: [
    { label: '`' }, { label: '1' }, { label: '2' }, { label: '3' }, { label: '4' }, { label: '5' },
    { label: '6' }, { label: '7' }, { label: '8' }, { label: '9' }, { label: '0' },
    { label: '-' }, { label: '=' }, { label: 'Backspace', width: 2 },
  ]},
  { keys: [
    { label: 'Tab', width: 1.5 },
    { label: 'Q' }, { label: 'W' }, { label: 'E' }, { label: 'R' }, { label: 'T' },
    { label: 'Y' }, { label: 'U' }, { label: 'I' }, { label: 'O' }, { label: 'P' },
    { label: '[' }, { label: ']' }, { label: '\\', width: 1.5 },
  ]},
  { keys: [
    { label: 'Caps', width: 1.75 },
    { label: 'A', world: 'galaxy' }, { label: 'S', world: 'ocean' }, { label: 'D', world: 'cyber' },
    { label: 'F', world: 'forest' }, { label: 'G', world: 'lava' },
    { label: 'H' }, { label: 'J' }, { label: 'K' }, { label: 'L' },
    { label: ';' }, { label: "'" }, { label: 'Enter', width: 2.25 },
  ]},
  { keys: [
    { label: 'Shift', width: 2.25 },
    { label: 'Z' }, { label: 'X' }, { label: 'C' }, { label: 'V' }, { label: 'B' },
    { label: 'N' }, { label: 'M' }, { label: ',' }, { label: '.' }, { label: '/' },
    { label: 'Shift', width: 2.25 },
  ]},
  { keys: [
    { label: 'Ctrl', width: 1.5 }, { label: 'Fn' }, { label: 'Win' }, { label: 'Alt', width: 1.25 },
    { label: 'Space', width: 6.25, world: 'hyperspace' },
    { label: 'Alt', width: 1.25 }, { label: 'Ctrl', width: 1.5 },
  ]},
];

export const WORLD_NAMES: Record<string, string> = {
  galaxy: 'The Galaxy',
  ocean: 'The Ocean',
  cyber: 'Cyberpunk City',
  forest: 'Enchanted Forest',
  lava: 'Lava Core',
  hyperspace: 'Hyperspace Portal',
  void: 'Unknown Universe',
};

export const WORLD_COLORS: Record<string, string> = {
  galaxy: '#7dd3fc',
  ocean: '#38bdf8',
  cyber: '#f472b6',
  forest: '#4ade80',
  lava: '#fb923c',
  hyperspace: '#a78bfa',
  void: '#94a3b8',
};
