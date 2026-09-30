//! deno_core TypeScript/JavaScript Native Messaging host
//! https://github.com/denoland/roll-your-own-javascript-runtime
//! https://github.com/guest271314/roll-your-own-javascript-runtime
//! guest271314 9-20-2026

const STDIN_RID: number = 0;
const STDOUT_RID: number = 1;
const STDERR_RID: number = 2;

async function readStdinBytes(buffer: Uint8Array<ArrayBuffer>): Promise<number> {
  return Deno.core.ops.op_read(STDIN_RID, buffer);
}

async function writeStdoutBytes(buffer: Uint8Array<ArrayBuffer>): Promise<number> {
  return Deno.core.ops.op_write(STDOUT_RID, buffer);
}

async function writeStderrBytes(buffer: Uint8Array<ArrayBuffer>): Promise<number> {
  return Deno.core.ops.op_write(STDERR_RID, buffer);
}

async function encode(str: string): Uint8Array<ArrayBuffer> {
  return Deno.encode(str);
}

function exit(exitCode: number = 0): void {
  // 1. Force close the OS resource channels tracked by your Rust application
  Deno.core.close(STDIN_RID);
  Deno.core.close(STDOUT_RID);
  Deno.core.close(STDERR_RID);
  if (exitCode > 0) {
    // 2. Throw an explicit error to halt the immediate synchronous execution thread
    throw new Error(`ProcessExit: ${exitCode}`);
  }
}

const buffer: ArrayBuffer = new ArrayBuffer(0, {
  maxByteLength: 1024 ** 2 * 64,
});
// const encoder: TextEncoder = new TextEncoder();

function encodeMessage(message: object): Uint8Array<ArrayBuffer> {
  const jsonString: string = JSON.stringify(message);
  const encoded: Uint8Array = encode(jsonString);
  return new Uint8Array(encoded.buffer) as Uint8Array<ArrayBuffer>;
}

async function readExactly(
  bytesToRead: number,
  targetBuffer: Uint8Array<ArrayBuffer>,
  offset: number,
): Promise<boolean> {
  let totalRead: number = 0;
  while (totalRead < bytesToRead) {
    const subview: Uint8Array<ArrayBuffer> = targetBuffer.subarray(
      offset + totalRead,
      offset + bytesToRead,
    ) as Uint8Array<ArrayBuffer>;
    const chunk: number | null = await readStdinBytes(
      subview,
    );
    if (chunk === 0 || chunk === null) {
      return false;
    }
    totalRead += chunk;
  }
  return true;
}

async function* getMessage(): AsyncGenerator<
  Uint8Array<ArrayBuffer>,
  void,
  unknown
> {
  const headerBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(4) as Uint8Array<
    ArrayBuffer
  >;

  while (true) {
    const successHeader: boolean = await readExactly(4, headerBuffer, 0);
    if (!successHeader) return;

    // Extract little-endian 32-bit unsigned integer using bitwise operations
    const totalMessageLength: number = (
      (headerBuffer[3] << 24) |
      (headerBuffer[2] << 16) |
      (headerBuffer[1] << 8) |
      (headerBuffer[0])
    ) >>> 0; // Use zero-fill right shift to force an unsigned 32-bit integer

    (buffer as ArrayBuffer).resize(totalMessageLength);
    const bodySlice: Uint8Array<ArrayBuffer> = new Uint8Array(
      buffer,
    ) as Uint8Array<ArrayBuffer>;

    const successBody: boolean = await readExactly(
      totalMessageLength,
      bodySlice,
      0,
    );
    if (!successBody) return;

    yield new Uint8Array(buffer.slice(0)) as Uint8Array<ArrayBuffer>;
    (buffer as ArrayBuffer).resize(0);
  }
}

async function sendMessage(message: Uint8Array<ArrayBuffer>): Promise<void> {
  const COMMA: number = 44;
  const OPEN_BRACKET: number = 91;
  const CLOSE_BRACKET: number = 93;
  const CHUNK_SIZE: number = 1024 * 1024;

  if (message.length <= CHUNK_SIZE) {
    const sizeBuffer: Uint32Array = new Uint32Array([message.length]);
    const header: Uint8Array<ArrayBuffer> = new Uint8Array(
      sizeBuffer.buffer,
    ) as Uint8Array<ArrayBuffer>;
    await writeStdoutBytes(header);
    await writeStdoutBytes(message);
    return;
  }

  let index: number = 0;

  while (index < message.length) {
    let splitIndex: number = 0;
    let searchStart: number = index + CHUNK_SIZE - 8;

    if (searchStart >= message.length) {
      splitIndex = message.length;
    } else {
      splitIndex = message.indexOf(COMMA, searchStart);
      if (splitIndex === -1) {
        splitIndex = message.length;
      }
    }

    const rawChunk: Uint8Array<ArrayBuffer> = message.subarray(
      index,
      splitIndex,
    ) as Uint8Array<ArrayBuffer>;
    const startByte: number = rawChunk[0];
    const endByte: number = rawChunk[rawChunk.length - 1];

    let prepend: number | null = null;
    let append: number | null = null;

    if (startByte === OPEN_BRACKET && endByte !== CLOSE_BRACKET) {
      append = CLOSE_BRACKET;
    } else if (startByte === COMMA) {
      prepend = OPEN_BRACKET;
      if (endByte !== CLOSE_BRACKET) {
        append = CLOSE_BRACKET;
      }
    }

    let bodyLength: number = rawChunk.length;
    let sourceOffset: number = 0;
    if (startByte === COMMA) {
      sourceOffset = 1;
      bodyLength -= 1;
    }

    const totalLength: number = 4 + (prepend !== null ? 1 : 0) + bodyLength +
      (append !== null ? 1 : 0);
    const output: Uint8Array<ArrayBuffer> = new Uint8Array(
      totalLength,
    ) as Uint8Array<ArrayBuffer>;

    const dataPayloadLen: number = totalLength - 4;
    output[0] = (dataPayloadLen >> 0) & 0xff;
    output[1] = (dataPayloadLen >> 8) & 0xff;
    output[2] = (dataPayloadLen >> 16) & 0xff;
    output[3] = (dataPayloadLen >> 24) & 0xff;

    let cursor: number = 4;
    if (prepend !== null) {
      output[cursor] = prepend;
      cursor++;
    } else if (startByte === COMMA) {
      output[cursor] = OPEN_BRACKET;
      cursor++;
    }

    const subview: Uint8Array<ArrayBuffer> = rawChunk.subarray(
      sourceOffset,
    ) as Uint8Array<ArrayBuffer>;
    output.set(subview, cursor);
    cursor += bodyLength;

    if (append !== null) {
      output[cursor] = append;
    }

    await writeStdoutBytes(output);
    index = splitIndex;
  }
}

async function main(): Promise<void> {
  try {
    for await (const message of getMessage()) {
      await sendMessage(message);
    }
  } catch (e) {
    writeStderrBytes(encodeMessage(e.message)).catch((_) => {
      exit(1);
    });
  }
}

(globalThis as any).main = main;

main().catch((_) => {
  exit(1);
});
