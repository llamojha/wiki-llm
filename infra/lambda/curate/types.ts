export type FileBlock = {
  path: string;
  content: string;
};

export type FileStatus = 'pending' | 'processing' | 'done' | 'error';

export type FileStage =
  | 'reading'
  | 'extracting'
  | 'writing'
  | 'manifest';

export type JobFile = {
  key: string;
  status: FileStatus;
  pages?: string[];
  error?: string;
  /** Sub-stage within `processing`. Cleared once status flips to done/error. */
  stage?: FileStage;
  /** ISO timestamp set when status moves to `processing`. */
  startedAt?: string;
  /** ISO timestamp set when status flips to `done` or `error`. */
  finishedAt?: string;
};

export type JobState = {
  id: string;
  status: 'processing' | 'done' | 'error' | 'cancelled';
  space: string;
  total: number;
  completed: number;
  files: JobFile[];
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  /**
   * Sub-state inside `status: 'processing'`. Set to `'chaining'` immediately
   * before the Lambda re-invokes itself to continue a batch past its timeout.
   * Cleared when the next invocation begins or the job finishes.
   */
  phase?: 'chaining';
  /** ISO timestamp when `phase` was last set. */
  chainedAt?: string;
  /**
   * True once `/api/curate/finalize` has regenerated the affected space's
   * `index.md`, the master `index.md`, and invalidated the in-memory search
   * cache. Idempotent: a second call is a no-op.
   */
  finalized?: boolean;
  /** ISO timestamp when `finalized` flipped to true. */
  finalizedAt?: string;
};

export type ProcessedFileEntry = {
  processedAt: string;
  hash: string;
  space: string;
  pages: string[];
  sourceCard?: string;
};

export type ProcessedManifest = {
  files: Record<string, ProcessedFileEntry>;
};

export type CurateEvent = {
  jobId: string;
  space: string;
  files: string[];
  bucket: string;
  prefix: string;
  startIndex?: number;
};

export type SourceCardClaim = {
  text: string;
  evidence?: string;
};

export type SourceCard = {
  rawKey: string;
  title: string;
  summary: string;
  claims: SourceCardClaim[];
  entities: string[];
  concepts: string[];
  suggestedSpaces: string[];
  suggestedPages: string[];
  tags: string[];
};
