export type ViewKey = 'console' | 'observatory';

type Props = {
  view: ViewKey;
  onChange: (v: ViewKey) => void;
  active: number;        // in-flight synthesis count
};

/**
 * Slim secondary nav directly below the TopBar.
 * Reuses the `.tab` style from styles.css so it visually rhymes with the
 * tab strip inside the CodeSnippet panel.
 */
export function NavTabs({ view, onChange, active }: Props) {
  return (
    <nav className="border-b border-[var(--color-border)] bg-[var(--color-base)]">
      <div className="mx-auto max-w-[1280px] px-8 h-[32px] flex items-center justify-between">
        <div className="flex items-center">
          <Tab label="console"      active={view === 'console'}      onClick={() => onChange('console')} />
          <Tab label="observatory"  active={view === 'observatory'}  onClick={() => onChange('observatory')}>
            {active > 0 && (
              <span
                className="ml-2 inline-flex items-center gap-1 px-1.5 py-px text-[9px] tracking-[0.1em] phos-text border border-[var(--color-phos-dim)] bg-[var(--color-phos-bg)]"
                title={`${active} synth${active === 1 ? '' : 'es'} in flight`}
              >
                <span className="led" style={{ width: 5, height: 5 }} />
                {active}
              </span>
            )}
          </Tab>
        </div>
      </div>
    </nav>
  );
}

function Tab({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className={'tab ' + (active ? 'active' : '')}>
      {label}
      {children}
    </button>
  );
}
