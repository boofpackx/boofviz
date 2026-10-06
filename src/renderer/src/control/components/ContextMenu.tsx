import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';

export interface MenuItem {
  label: string;
  hint?: string;
  disabled?: boolean;
  onSelect?: () => void;
  items?: MenuItem[];
  separator?: boolean;
}

interface MenuState {
  open: { x: number; y: number; items: MenuItem[] } | null;
  show(x: number, y: number, items: MenuItem[]): void;
  close(): void;
}

export const useMenu = create<MenuState>((set) => ({
  open: null,
  show: (x, y, items) => set({ open: { x, y, items } }),
  close: () => set({ open: null }),
}));

/** Right-click helper: `<div onContextMenu={contextMenu(() => items)}>`. */
export function contextMenu(items: () => MenuItem[]) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    useMenu.getState().show(e.clientX, e.clientY, items());
  };
}

function MenuList({ items, x, y, onDone }: { items: MenuItem[]; x: number; y: number; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<{ i: number; x: number; y: number } | null>(null);

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 4), y: Math.min(y, window.innerHeight - r.height - 4) });
  }, [x, y]);

  return (
    <>
      <div
        ref={ref}
        className="fixed z-50 min-w-44 rounded-md border border-ink-600 bg-ink-850 py-1 shadow-2xl shadow-black/60"
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {items.map((item, i) =>
          item.separator ? (
            <div key={i} className="my-1 h-px bg-ink-700" />
          ) : (
            <button
              key={i}
              type="button"
              disabled={item.disabled}
              onMouseEnter={(e) => {
                if (item.items) {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setSub({ i, x: r.right - 2, y: r.top - 4 });
                } else setSub(null);
              }}
              onClick={() => {
                if (item.items) return;
                item.onSelect?.();
                onDone();
              }}
              className={`flex w-full items-center justify-between gap-4 px-3 py-1 text-left text-[12px] disabled:opacity-40 ${sub?.i === i ? 'bg-ink-700 text-ink-100' : 'text-ink-200 hover:bg-ink-700'}`}
            >
              <span>{item.label}</span>
              <span className="text-[10px] text-ink-400">{item.items ? '▸' : item.hint}</span>
            </button>
          ),
        )}
      </div>
      {sub && items[sub.i]?.items && <MenuList items={items[sub.i].items!} x={sub.x} y={sub.y} onDone={onDone} />}
    </>
  );
}

/** Mount once near the app root. Not modal: clicking anywhere or Escape closes it. */
export function ContextMenuHost(): ReactNode {
  const open = useMenu((s) => s.open);
  const close = useMenu((s) => s.close);
  useEffect(() => {
    if (!open) return;
    const onDown = (): void => close();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onDown);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onDown);
    };
  }, [open, close]);
  if (!open) return null;
  return <MenuList items={open.items} x={open.x} y={open.y} onDone={close} />;
}
