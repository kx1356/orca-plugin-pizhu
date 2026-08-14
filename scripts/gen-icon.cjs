// 生成插件 icon.png：128x128，琥珀色圆角底 + 白色波浪线 + 角标方块
// 纯 Node 实现（zlib 手写 PNG），无第三方依赖
const zlib = require("zlib")
const fs = require("fs")

const S = 128
const rows = []

function px(x, y, r, g, b, a) {
  if (x < 0 || x >= S || y < 0 || y >= S) return
  const i = (y * S + x) * 4
  rows[i] = r
  rows[i + 1] = g
  rows[i + 2] = b
  rows[i + 3] = a
}

// 初始化透明
const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0 // filter: none
}
for (let i = 0; i < S * S; i++) {
  const o = i * 4
  rows[o] = 0
  rows[o + 1] = 0
  rows[o + 2] = 0
  rows[o + 3] = 0
}

// 圆角底（琥珀色）
const R = 28
function inRoundedRect(x, y) {
  if (x < R && y < R) return (x - R) ** 2 + (y - R) ** 2 <= R * R
  if (x >= S - R && y < R) return (x - (S - R)) ** 2 + (y - R) ** 2 <= R * R
  if (x < R && y >= S - R) return (x - R) ** 2 + (y - (S - R)) ** 2 <= R * R
  if (x >= S - R && y >= S - R)
    return (x - (S - R)) ** 2 + (y - (S - R)) ** 2 <= R * R
  return true
}
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    if (inRoundedRect(x, y)) px(x, y, 250, 168, 72, 255)
  }
}

// 抗锯齿圆角边缘（简化：1px 半透明）
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    if (!inRoundedRect(x, y)) {
      let n = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (inRoundedRect(x + dx, y + dy)) n++
      if (n > 0) px(x, y, 250, 168, 72, Math.round((n / 9) * 220))
    }
  }
}

// 白色波浪线（3px 粗）
const cy = 58
for (let x = 16; x < S - 16; x++) {
  const y = Math.round(cy + 9 * Math.sin((x / S) * Math.PI * 4))
  for (let dy = -1; dy <= 1; dy++) {
    px(x, y + dy, 255, 255, 255, 255)
    px(x, y + dy + 1, 255, 255, 255, 160)
  }
}

// 角标：右下小圆角方块 + 白色数字感（画两条横杠表示序号）
const bx0 = 84, by0 = 82, bw = 30, bh = 24, br = 8
for (let y = by0; y < by0 + bh; y++) {
  for (let x = bx0; x < bx0 + bw; x++) {
    const inRect =
      (x < bx0 + br && y < by0 + br && (x - (bx0 + br)) ** 2 + (y - (by0 + br)) ** 2 <= br * br) ||
      (x >= bx0 + bw - br && y < by0 + br && (x - (bx0 + bw - br)) ** 2 + (y - (by0 + br)) ** 2 <= br * br) ||
      (x < bx0 + br && y >= by0 + bh - br && (x - (bx0 + br)) ** 2 + (y - (by0 + bh - br)) ** 2 <= br * br) ||
      (x >= bx0 + bw - br && y >= by0 + bh - br && (x - (bx0 + bw - br)) ** 2 + (y - (by0 + bh - br)) ** 2 <= br * br) ||
      (x >= bx0 + br && x < bx0 + bw - br) || (y >= by0 + br && y < by0 + bh - br)
    if (inRect) px(x, y, 255, 255, 255, 255)
  }
}
// 角标里画两道波浪短线（1 和 2 的感觉）
for (let x = bx0 + 7; x < bx0 + 13; x++) {
  const y = by0 + 8 + Math.round(2 * Math.sin((x / 6) * Math.PI))
  px(x, y, 250, 168, 72, 255)
}
for (let x = bx0 + 17; x < bx0 + 23; x++) {
  const y = by0 + 15 + Math.round(2 * Math.sin((x / 6) * Math.PI))
  px(x, y, 250, 168, 72, 255)
}

// 组装 PNG
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, "ascii")
  const crcBuf = Buffer.alloc(4)
  const crc = zlib.crc32 ? null : null
  // 手动 CRC32
  const table = (() => {
    const t = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })()
  let c = 0xffffffff
  const body = Buffer.concat([typeBuf, data])
  for (const b of body) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
  crcBuf.writeUInt32BE((c ^ 0xffffffff) >>> 0)
  return Buffer.concat([len, body, crcBuf])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0)
ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
// 其余默认

// 像素写入 raw（filter 字节已预留）
for (let y = 0; y < S; y++) {
  const rowStart = y * (S * 4 + 1) + 1
  for (let x = 0; x < S; x++) {
    const src = (y * S + x) * 4
    const dst = rowStart + x * 4
    raw[dst] = rows[src]
    raw[dst + 1] = rows[src + 1]
    raw[dst + 2] = rows[src + 2]
    raw[dst + 3] = rows[src + 3]
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
])

fs.writeFileSync(__dirname + "/icon.png", png)
console.log("icon.png written:", png.length, "bytes")
