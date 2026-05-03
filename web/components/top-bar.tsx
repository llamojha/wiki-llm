'use client';

import { ICONS } from '@/lib/icons';
import type { Theme } from '@/lib/theme';

type TopBarProps = {
  onSearch: () => void;
  onToggleChat: () => void;
  chatOpen: boolean;
  theme: Theme;
  setTheme: (t: Theme) => void;
};

export function TopBar({ onSearch, onToggleChat, chatOpen, theme, setTheme }: TopBarProps) {
  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-mark">w</div>
        <div className="brand-name">WikiLLM <span>/ knowledge</span></div>
        <span className="tenant-pill">acme</span>
      </div>
      <div className="topbar-search">
        <button className="search-trigger" onClick={onSearch}>
          {ICONS.search}
          <span>Search docs, runbooks, people…</span>
          <span className="kbd">⌘K</span>
        </button>
      </div>
      <div className="topbar-actions">
        <button className="icon-btn" title="Toggle theme"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? ICONS.sun : ICONS.moon}
        </button>
        <button className="icon-btn" title="Notifications">
          {ICONS.bell}
          <span className="dot"></span>
        </button>
        <button className={'ask-btn' + (chatOpen ? ' active' : '')}
                onClick={onToggleChat} title="Ask the wiki">
          {ICONS.spark}
          <span>Ask the wiki</span>
          <span className="kbd-inv">⌘⇧A</span>
        </button>
        <div className="avatar" title="hello@acme.io">YO</div>
      </div>
    </div>
  );
}
