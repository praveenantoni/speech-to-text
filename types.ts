
export enum TimestampMode {
  WORDSTAMP = 'wordstamp',
  SENTENCE = 'sentence',
}

export enum TimestampFormat {
  HMS = 'hh:mm:ss.000',
  MS = '000000ms',
}

export enum Punctuation {
  ON = 'on',
  OFF = 'off',
}

export interface TranscriptionSettings {
  timestampMode: TimestampMode;
  timestampFormat: TimestampFormat;
  punctuation: Punctuation;
}

export interface TranscriptionCue {
  word: string;
  start: number; // in milliseconds
  end: number; // in milliseconds
}

export type ProcessingStatus = 'idle' | 'transcribing' | 'completed' | 'error';

export interface TranscriptionItem {
  id: string;
  file: File;
  mediaType: 'audio' | 'video';
  status: ProcessingStatus;
  cues: TranscriptionCue[];
  fullTranscript: string;
  error?: string;
  timestamp: number; // For sorting
}
