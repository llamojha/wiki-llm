export type FileBlock = {
  path: string;
  content: string;
};

export type FileStatus = 'pending' | 'processing' | 'done' | 'error';

export type JobFile = {
  key: string;
  status: FileStatus;
  pages?: string[];
  error?: string;
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
};

export type ProcessedFileEntry = {
  processedAt: string;
  hash: string;
  space: string;
  pages: string[];
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
};
