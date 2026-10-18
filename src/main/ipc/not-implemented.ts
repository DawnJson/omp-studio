export function notImplemented(name: string): never {
  throw new Error(`not implemented: ${name}`);
}
