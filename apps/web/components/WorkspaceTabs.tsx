import type {KeyboardEvent} from 'react';

export type WorkArea = 'overview' | 'storyboard' | 'production' | 'review' | 'inspector';

const desktopTabs: Array<{value: WorkArea; label: string}> = [
  {value: 'overview', label: '总览'},
  {value: 'storyboard', label: '分镜'},
  {value: 'production', label: '生产'},
  {value: 'review', label: '审核'},
];

const mobileTabs: Array<{value: WorkArea; label: string}> = [
  {value: 'overview', label: '总览'},
  {value: 'storyboard', label: '分镜'},
  {value: 'production', label: '生产'},
  {value: 'inspector', label: '检查器'},
];

export function WorkspaceTabs({
  value,
  onChange,
  mobile = false,
}: {
  value: WorkArea;
  onChange: (value: WorkArea) => void;
  mobile?: boolean;
}) {
  const tabs = mobile ? mobileTabs : desktopTabs;
  const moveSelection = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    onChange(next.value);
    document.getElementById(`workspace-tab-${next.value}`)?.focus();
  };
  return (
    <nav
      className={mobile ? 'workspace-tabs workspace-tabs-mobile mobile-tabs' : 'workspace-tabs workspace-tabs-desktop'}
      role="tablist"
      aria-label="工作区"
      style={{display: mobile ? 'grid' : 'flex', gridTemplateColumns: mobile ? 'repeat(4, minmax(0, 1fr))' : undefined, height: 44}}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          id={`workspace-tab-${tab.value}`}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          aria-controls={`workspace-panel-${tab.value}`}
          tabIndex={value === tab.value ? 0 : -1}
          className={value === tab.value ? 'active' : ''}
          style={{flex: mobile ? undefined : '1 1 0', minWidth: 72, height: 44}}
          onClick={() => onChange(tab.value)}
          onKeyDown={event => moveSelection(event, index)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
