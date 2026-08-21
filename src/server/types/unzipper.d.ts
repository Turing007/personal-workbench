declare module 'unzipper' {
  interface ZipEntry {
    path: string;
    buffer(): Promise<Buffer>;
  }

  interface OpenedDirectory {
    files: ZipEntry[];
  }

  export const Open: {
    buffer(input: Buffer): Promise<OpenedDirectory>;
  };
}
