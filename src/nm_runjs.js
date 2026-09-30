//! deno_core JavaScript Native Messaging host
// Transpiled TypeScript to JavaScript from snapshot target/release/build/nm_runjsxxxxxxxxxxxxxxxx/nm_runjs.bin
//! https://github.com/denoland/roll-your-own-javascript-runtime
//! https://github.com/guest271314/roll-your-own-javascript-runtime
//! guest271314 9-20-2026
const STDIN_RID = 0;
const STDOUT_RID = 1;
const STDERR_RID = 2;
async function readStdinBytes(buffer) {
  return Deno.core.ops.op_read(STDIN_RID, buffer);
}
async function writeStdoutBytes(buffer) {
  return Deno.core.ops.op_write(STDOUT_RID, buffer);
}
async function writeStderrBytes(buffer) {
  return Deno.core.ops.op_write(STDERR_RID, buffer);
}
async function encode(str) {
  return Deno.encode(str);
}
function exit(exitCode = 0) {
  // 1. Force close the OS resource channels tracked by your Rust application
  Deno.core.close(STDIN_RID);
  Deno.core.close(STDOUT_RID);
  Deno.core.close(STDERR_RID);
  if (exitCode > 0) {
    // 2. Throw an explicit error to halt the immediate synchronous execution thread
    throw new Error(`ProcessExit: ${exitCode}`);
  }
}
const buffer = new ArrayBuffer(0, {
  maxByteLength: 1024 ** 2 * 64
});
// const encoder: TextEncoder = new TextEncoder();
function encodeMessage(message) {
  const jsonString = JSON.stringify(message);
  const encoded = encode(jsonString);
  return new Uint8Array(encoded.buffer);
}
async function readExactly(bytesToRead, targetBuffer, offset) {
  let totalRead = 0;
  while(totalRead < bytesToRead){
    const subview = targetBuffer.subarray(offset + totalRead, offset + bytesToRead);
    const chunk = await readStdinBytes(subview);
    if (chunk === 0 || chunk === null) {
      return false;
    }
    totalRead += chunk;
  }
  return true;
}
async function* getMessage() {
  const headerBuffer = new Uint8Array(4);
  while(true){
    const successHeader = await readExactly(4, headerBuffer, 0);
    if (!successHeader) return;
    // Extract little-endian 32-bit unsigned integer using bitwise operations
    const totalMessageLength = (headerBuffer[3] << 24 | headerBuffer[2] << 16 | headerBuffer[1] << 8 | headerBuffer[0]) >>> 0; // Use zero-fill right shift to force an unsigned 32-bit integer
    buffer.resize(totalMessageLength);
    const bodySlice = new Uint8Array(buffer);
    const successBody = await readExactly(totalMessageLength, bodySlice, 0);
    if (!successBody) return;
    yield new Uint8Array(buffer.slice(0));
    buffer.resize(0);
  }
}
async function sendMessage(message) {
  const COMMA = 44;
  const OPEN_BRACKET = 91;
  const CLOSE_BRACKET = 93;
  const CHUNK_SIZE = 1024 * 1024;
  if (message.length <= CHUNK_SIZE) {
    const sizeBuffer = new Uint32Array([
      message.length
    ]);
    const header = new Uint8Array(sizeBuffer.buffer);
    await writeStdoutBytes(header);
    await writeStdoutBytes(message);
    return;
  }
  let index = 0;
  while(index < message.length){
    let splitIndex = 0;
    let searchStart = index + CHUNK_SIZE - 8;
    if (searchStart >= message.length) {
      splitIndex = message.length;
    } else {
      splitIndex = message.indexOf(COMMA, searchStart);
      if (splitIndex === -1) {
        splitIndex = message.length;
      }
    }
    const rawChunk = message.subarray(index, splitIndex);
    const startByte = rawChunk[0];
    const endByte = rawChunk[rawChunk.length - 1];
    let prepend = null;
    let append = null;
    if (startByte === OPEN_BRACKET && endByte !== CLOSE_BRACKET) {
      append = CLOSE_BRACKET;
    } else if (startByte === COMMA) {
      prepend = OPEN_BRACKET;
      if (endByte !== CLOSE_BRACKET) {
        append = CLOSE_BRACKET;
      }
    }
    let bodyLength = rawChunk.length;
    let sourceOffset = 0;
    if (startByte === COMMA) {
      sourceOffset = 1;
      bodyLength -= 1;
    }
    const totalLength = 4 + (prepend !== null ? 1 : 0) + bodyLength + (append !== null ? 1 : 0);
    const output = new Uint8Array(totalLength);
    const dataPayloadLen = totalLength - 4;
    output[0] = dataPayloadLen >> 0 & 0xff;
    output[1] = dataPayloadLen >> 8 & 0xff;
    output[2] = dataPayloadLen >> 16 & 0xff;
    output[3] = dataPayloadLen >> 24 & 0xff;
    let cursor = 4;
    if (prepend !== null) {
      output[cursor] = prepend;
      cursor++;
    } else if (startByte === COMMA) {
      output[cursor] = OPEN_BRACKET;
      cursor++;
    }
    const subview = rawChunk.subarray(sourceOffset);
    output.set(subview, cursor);
    cursor += bodyLength;
    if (append !== null) {
      output[cursor] = append;
    }
    await writeStdoutBytes(output);
    index = splitIndex;
  }
}
async function main() {
  try {
    for await (const message of getMessage()){
      await sendMessage(message);
    }
  } catch (e) {
    writeStderrBytes(encodeMessage(e.message)).catch((_)=>{
      exit(1);
    });
  }
}
globalThis.main = main;
main().catch((_)=>{
  exit(1);
});
