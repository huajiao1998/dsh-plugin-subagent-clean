
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 0xfd2fb528
const SKIP_MASK = 0xfffffff0
const SKIP_MAGIC = 0x184d2a50
const NL = String.fromCharCode(10)

/** Enumerate independently decodable Zstandard frames in one artifact. */
export function scanZstdFrames(buf) {
  const frames = []
  let pos = 0
  while (pos + 4 <= buf.length) {
    const magic = buf.readUInt32LE(pos)
    if ((magic & SKIP_MASK) === SKIP_MAGIC) {
      if (pos + 8 > buf.length) break
      const size = buf.readUInt32LE(pos + 4)
      frames.push({ start: pos, end: pos + 8 + size })
      pos += 8 + size
      continue
    }
    if (magic !== ZSTD_MAGIC) break
    const start = pos
    let p = pos + 4
    const fhd = buf[p]
    p += 1
    const fcsFlag = fhd >> 6
    const singleSegment = (fhd >> 5) & 1
    const hasChecksum = (fhd >> 2) & 1
    const dictIdFlag = fhd & 3
    if (!singleSegment) p += 1
    p += [0, 1, 2, 4][dictIdFlag]
    p += [singleSegment ? 1 : 0, 2, 4, 8][fcsFlag]
    for (;;) {
      if (p + 3 > buf.length) return frames
      const bh = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16)
      const last = bh & 1
      const type = (bh >> 1) & 3
      const size = bh >>> 3
      p += 3 + (type === 1 ? 1 : size)
      if (last) break
    }
    if (hasChecksum) p += 4
    frames.push({ start, end: p })
    pos = p
  }
  return frames
}

/** Decode every frame and concatenate the plaintext. */
export function decodeLog(buf) {
  const frames = scanZstdFrames(buf)
  const parts = frames.map((f) => zstdDecompressSync(buf.subarray(f.start, f.end)))
  return Buffer.concat(parts).toString('utf8')
}

/**
 * Re-encode a session log the way the store writes it: the header lives alone in
 * its own frame (the loader asserts exactly that), events follow in batches.
 */
export function encodeLog(headerLine, eventLines, perFrame = 400) {
  const frames = [zstdCompressSync(Buffer.from(headerLine + NL))]
  for (let i = 0; i < eventLines.length; i += perFrame) {
    const chunk = eventLines.slice(i, i + perFrame).join(NL) + NL
    frames.push(zstdCompressSync(Buffer.from(chunk)))
  }
  return Buffer.concat(frames)
}
