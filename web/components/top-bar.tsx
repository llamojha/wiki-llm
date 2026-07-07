'use client';

import { useEffect, useRef, useState } from 'react';
import { ICONS } from '@/lib/icons';
import type { Theme, ThemeInfo } from '@/lib/theme';
import type { FeatureFlags } from '@/lib/flags';

type TopBarProps = {
  onSearch: () => void;
  onToggleChat: () => void;
  chatOpen: boolean;
  theme: Theme;
  setTheme: (t: Theme) => void;
  themes: ThemeInfo[];
  flags: FeatureFlags;
  /** Vault name pill next to the brand; null/undefined hides it. */
  vaultName?: string | null;
};

export function TopBar({ onSearch, onToggleChat, chatOpen, theme, setTheme, themes, flags, vaultName }: TopBarProps) {
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const active = themes.find((t) => t.id === theme);
  const isDark = (active?.base ?? 'dark') === 'dark';
  // With only the built-ins the control stays a simple light/dark toggle;
  // theme plugins (docs/theming.md) turn it into a picker menu.
  const builtInsOnly = themes.length <= 2;

  useEffect(() => {
    if (!themeMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setThemeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [themeMenuOpen]);

  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M12 2C8 2 4 5 4 9c0 2.5 1.5 4.5 3.5 5.5C6.5 15.5 6 17 6 18h2c0-1 .5-2 1.5-2.5C10.5 16.5 11 18 11 19v3h2v-3c0-1 .5-2.5 1.5-3.5C15.5 16 16 17 16 18h2c0-1-.5-2.5-1.5-3.5C18.5 13.5 20 11.5 20 9c0-4-4-7-8-7z" fill="currentColor" opacity="0.85"/>
            <path d="M12 2c-2 0-4 1.5-5 3.5C8.5 4.5 10 4 12 4s3.5.5 5 1.5C16 3.5 14 2 12 2z" fill="currentColor" opacity="0.6"/>
          </svg>
        </div>
        <div className="brand-name">Canopy <span>– AI powered Wiki</span></div>
        {vaultName && <span className="tenant-pill">{vaultName}</span>}
      </div>
      <div className="topbar-search">
        {flags.search && (
          <button className="search-trigger" onClick={onSearch}>
            {ICONS.search}
            <span>Search docs, runbooks, people…</span>
            <span className="kbd">⌘K</span>
          </button>
        )}
      </div>
      <div className="topbar-actions">
        {builtInsOnly ? (
          <button className="icon-btn" title="Toggle theme"
                  onClick={() => setTheme(isDark ? 'light' : 'dark')}>
            {isDark ? ICONS.sun : ICONS.moon}
          </button>
        ) : (
          <div className="theme-picker" ref={pickerRef}>
            <button className="icon-btn" title={`Theme: ${active?.label ?? theme}`}
                    aria-haspopup="menu" aria-expanded={themeMenuOpen}
                    onClick={() => setThemeMenuOpen((o) => !o)}>
              {isDark ? ICONS.sun : ICONS.moon}
            </button>
            {themeMenuOpen && (
              <div className="theme-menu" role="menu">
                {themes.map((t) => (
                  <button key={t.id} role="menuitemradio" aria-checked={t.id === theme}
                          className={t.id === theme ? 'active' : ''}
                          onClick={() => { setTheme(t.id); setThemeMenuOpen(false); }}>
                    <span>{t.label}</span>
                    {t.id === theme && <span className="theme-menu-check">{ICONS.check}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {flags.agent && (
          <button className={'ask-btn' + (chatOpen ? ' active' : '')}
                  onClick={onToggleChat} title="Ask the wiki">
            {ICONS.spark}
            <span>Ask the wiki</span>
            <span className="kbd-inv">⌘⇧A</span>
          </button>
        )}
        <div className="avatar" title="hello@acme.io">YO</div>
      </div>
    </div>
  );
}
