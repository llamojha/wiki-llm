import { ICONS } from '@/lib/icons';

type ToastStackProps = { message: string | null };

export function ToastStack({ message }: ToastStackProps) {
  if (!message) return null;
  return (
    <div className="toast-stack">
      <div className="toast">{ICONS.check}{message}</div>
    </div>
  );
}
