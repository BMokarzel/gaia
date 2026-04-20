export type ClonePolicy = 'persist' | 'delete';

export type SourceDescriptor =
  | { kind: 'local'; path: string }
  | { kind: 'git'; url: string; branch?: string; ref?: string }
  | { kind: 'github'; owner: string; repo: string; ref?: string };

export interface PreparedSource {
  localPath: string;
  /** No-op para local; rm -rf para git com policy=delete */
  cleanup(): Promise<void>;
}

export interface IExtractionSourceAdapter {
  supports(descriptor: SourceDescriptor): boolean;
  prepare(descriptor: SourceDescriptor, policy?: ClonePolicy): Promise<PreparedSource>;
}
