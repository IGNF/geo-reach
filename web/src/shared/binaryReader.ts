/** A typed array constructor: Uint32Array, Float32Array… */
interface TypedArrayCtor<T> {
  new (buffer: ArrayBuffer, byteOffset: number, length: number): T;
  readonly BYTES_PER_ELEMENT: number;
}

/**
 * Reads a binary file block after block (the road and transit files of the regions). Typed arrays are views on the
 * downloaded buffer: nothing is copied nor parsed.
 */
export class BinaryReader {
  private readonly buffer: ArrayBuffer;
  private offset: number;

  constructor(buffer: ArrayBuffer, offset = 0) {
    this.buffer = buffer;
    this.offset = offset;
  }

  /** The next `length` values, as a view of the given type */
  array<T>(Ctor: TypedArrayCtor<T>, length: number): T {
    const array = new Ctor(this.buffer, this.offset, length);
    this.offset += length * Ctor.BYTES_PER_ELEMENT;

    return array;
  }

  /** The next `bytes` bytes, for mixed records read field by field */
  view(bytes: number): DataView {
    const view = new DataView(this.buffer, this.offset, bytes);
    this.offset += bytes;

    return view;
  }

  float64(): number {
    return this.view(8).getFloat64(0, true);
  }

  /** The next `bytes` bytes, as UTF-8 JSON */
  json<T>(bytes: number): T {
    const text = new TextDecoder().decode(this.array(Uint8Array, bytes));

    return JSON.parse(text) as T;
  }

  /** Skips to the next multiple of 4 bytes (32-bit arrays must be aligned) */
  align(): void {
    this.offset = (this.offset + 3) & ~3;
  }
}
