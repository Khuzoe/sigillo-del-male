export function iconFileStem(name) {
    return String(name || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')
        .slice(0, 60).replace(/^-|-$/g, '') || 'albero';
}

const extensions = new Map(Object.entries({
    'image/webp':'webp', 'image/png':'png', 'image/jpeg':'jpg', 'image/avif':'avif',
    'image/gif':'gif', 'image/svg+xml':'svg', 'image/bmp':'bmp', 'image/x-icon':'ico', 'image/vnd.microsoft.icon':'ico'
}));

function imageExtension(type, bytes) {
    const mime = type.split(';')[0];
    if (!bytes.length) return '';
    if (extensions.has(mime)) return extensions.get(mime);
    // Older campaign uploads may be served as generic binary data.
    if (mime && !mime.endsWith('/octet-stream')) return '';
    const signature = String.fromCharCode(...bytes.subarray(0, 12));
    if (signature.startsWith('RIFF') && signature.endsWith('WEBP')) return 'webp';
    if (signature.startsWith('\x89PNG\r\n\x1a\n')) return 'png';
    if (signature.startsWith('\xff\xd8\xff')) return 'jpg';
    if (signature.startsWith('GIF87a') || signature.startsWith('GIF89a')) return 'gif';
    return '';
}

const crcTable = Uint32Array.from({length:256}, (_, index) => {
    let crc = index;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    return crc;
});

// ZIP's store method keeps the original image bytes. Both records carry the same
// UTF-8 flag, timestamp, CRC and sizes, starting at their "version needed" field.
function writeFileFields(view, offset, size, checksum, nameLength, date) {
    view.setUint16(offset, 20, true);
    view.setUint16(offset + 2, 0x0800, true);
    view.setUint16(offset + 6, (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1), true);
    view.setUint16(offset + 8, ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(), true);
    view.setUint32(offset + 10, checksum, true);
    view.setUint32(offset + 14, size, true);
    view.setUint32(offset + 18, size, true);
    view.setUint16(offset + 22, nameLength, true);
}

export async function buildSkillTreeIconPack(files, signal, onFile) {
    const contents = [], directory = [], skipped = [];
    const encoder = new TextEncoder(), date = new Date();
    let offset = 0, directorySize = 0, count = 0;
    for (const file of files) {
        signal.throwIfAborted();
        onFile(file.label);
        let blob, bytes, extension;
        try {
            blob = await file.load();
            bytes = new Uint8Array(await blob.arrayBuffer());
            extension = imageExtension(blob.type, bytes);
        } catch { signal.throwIfAborted(); }
        if (!extension) { skipped.push(file.label); continue; }

        const name = encoder.encode(file.path + '.' + extension);
        const local = new DataView(new ArrayBuffer(30)), central = new DataView(new ArrayBuffer(46));
        let crc = 0xffffffff;
        for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
        local.setUint32(0, 0x04034b50, true);
        writeFileFields(local, 4, blob.size, ~crc, name.length, date);
        central.setUint32(0, 0x02014b50, true);
        central.setUint16(4, 20, true);
        writeFileFields(central, 6, blob.size, ~crc, name.length, date);
        central.setUint32(42, offset, true);
        offset += local.byteLength + name.length + blob.size;
        directorySize += central.byteLength + name.length;
        if (++count >= 0xffff || offset + directorySize + 22 >= 0xffffffff) throw new Error('Il pacchetto supera le dimensioni massime di un file ZIP.');
        contents.push(local, name, blob);
        directory.push(central, name);
    }
    signal.throwIfAborted();
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, count, true);
    end.setUint16(10, count, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, offset, true);
    return {blob:count ? new Blob([...contents, ...directory, end], {type:'application/zip'}) : null, count, skipped};
}
