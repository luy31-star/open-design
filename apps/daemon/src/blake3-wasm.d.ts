declare module 'blake3-wasm' {
  export function hash(input: string | ArrayBuffer | ArrayBufferView): Uint8Array;
}
