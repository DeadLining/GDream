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
  return (
    <nav
      className={mobile ? 'workspace-tabs workspace-tabs-mobile mobile-tabs' : 'workspace-tabs workspace-tabs-desktop'}
      role="tablist"
      aria-label="工作区"
      style={{display: mobile ? 'grid' : 'flex', gridTemplateColumns: mobile ? 'repeat(4, minmax(0, 1fr))' : undefined, height: 44}}
    >
      {tabs.map(tab => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={value === tab.value ? 'active' : ''}
          style={{flex: mobile ? undefined : '1 1 0', minWidth: 72, height: 44}}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
