import { ICONS } from '@/lib/icons';

type ChatFabProps = { onClick: () => void };

export function ChatFab({ onClick }: ChatFabProps) {
  return (
    <button className="chat-fab" onClick={onClick}>
      <span className="fab-pulse"></span>
      {ICONS.spark}
      <span>Ask the wiki</span>
      <span className="fab-kbd">⌘⇧A</span>
    </button>
  );
}
