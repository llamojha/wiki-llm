import type { ReactNode } from 'react';

export type IconKey =
  | 'folder'
  | 'doc'
  | 'chev'
  | 'search'
  | 'bell'
  | 'spark'
  | 'sun'
  | 'moon'
  | 'plus'
  | 'edit'
  | 'share'
  | 'copy'
  | 'more'
  | 'home'
  | 'star'
  | 'recent'
  | 'user'
  | 'lock'
  | 'globe'
  | 'arrow'
  | 'send'
  | 'attach'
  | 'check'
  | 'info'
  | 'warn'
  | 'close'
  | 'settings'
  | 'tag'
  | 'upload'
  | 's3'
  | 'file'
  | 'trash';

export const ICONS: Record<IconKey, ReactNode> = {
  folder: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M1.5 4.5C1.5 3.67 2.17 3 3 3h2.59c.4 0 .78.16 1.06.44L7.5 4.29c.28.28.66.44 1.06.44H13c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5v-8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  ),
  doc: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M3 2h6.5L13 5.5V14H3V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M9.5 2v3.5H13" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5.5 8h5M5.5 10.5h5M5.5 6h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  chev: (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
      <path d="M3 1.5L6 4.5L3 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  search: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M10.5 10.5L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  bell: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M4 6.5a4 4 0 118 0v2.4l1 1.6H3l1-1.6V6.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M6.5 12.5a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  spark: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5l1.5 4L13.5 7l-4 1.5L8 12.5l-1.5-4L2.5 7l4-1.5L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  sun: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1 1M5.4 10.6l-1 1M12.6 12.6l-1-1M5.4 5.4l-1-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  moon: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M13 9.5A5.5 5.5 0 116.5 3a4.5 4.5 0 006.5 6.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  ),
  plus: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M6.5 2v9M2 6.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  edit: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  ),
  share: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="4" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="12" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="12" cy="12" r="1.8" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M5.6 7.2l4.8-2.4M5.6 8.8l4.8 2.4" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  ),
  copy: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <rect x="5" y="2" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M11 11v2.5c0 .55-.45 1-1 1H3.5c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1H5" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  ),
  more: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="3.5" cy="8" r="1" fill="currentColor"/>
      <circle cx="8" cy="8" r="1" fill="currentColor"/>
      <circle cx="12.5" cy="8" r="1" fill="currentColor"/>
    </svg>
  ),
  home: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M2.5 7.5L8 2.5l5.5 5v6h-4v-4h-3v4h-4v-6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  ),
  star: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M8 2l1.7 4 4.3.4-3.3 3 1 4.3L8 11.5 4.3 13.7l1-4.3-3.3-3 4.3-.4L8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  ),
  recent: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M8 4.5V8l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  user: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M2.5 13.5c.7-2.4 2.9-4 5.5-4s4.8 1.6 5.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  lock: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="7" width="10" height="7" rx="1.4" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  ),
  globe: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  ),
  arrow: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  send: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M2.5 8L13.5 2.5L11 13.5L7.5 9L2.5 8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none"/>
    </svg>
  ),
  attach: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M11.5 7L6.7 11.8a2.4 2.4 0 11-3.4-3.4l5.5-5.5a1.6 1.6 0 012.3 2.3L5.6 10.7a.8.8 0 01-1.1-1.1l4.2-4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  check: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M3 8.5L6.5 12 13 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  info: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M8 7v4M8 4.8v.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  warn: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5L15 13.5H1L8 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M8 6v4M8 11.8v.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  close: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  settings: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7L3.4 3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  tag: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M2 2v6l7 7 6-6-7-7H2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <circle cx="5" cy="5" r=".8" fill="currentColor"/>
    </svg>
  ),
  upload: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M8 10.5V2.5M8 2.5L4.5 6M8 2.5L11.5 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2.5 10v2.5c0 .55.45 1 1 1h9c.55 0 1-.45 1-1V10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  s3: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <ellipse cx="8" cy="3.5" rx="5" ry="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M3 3.5v9c0 .83 2.24 1.5 5 1.5s5-.67 5-1.5v-9" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M3 7.5c0 .83 2.24 1.5 5 1.5s5-.67 5-1.5M3 10.5c0 .83 2.24 1.5 5 1.5s5-.67 5-1.5" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  ),
  file: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M3 2h6.5L13 5.5V14H3V2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M9.5 2v3.5H13" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  ),
  trash: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5c.04.55.5 1 1.05 1h4.5c.55 0 1-.45 1.05-1L12 4M6.5 7v5M9.5 7v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
};
