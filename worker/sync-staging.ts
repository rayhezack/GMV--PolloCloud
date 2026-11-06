const MAX_STAGING_PAYLOAD_BYTES = 60 * 1024;

export function serializeStagingChunks(rows: unknown[]) {
  const encoder = new TextEncoder();
  const chunks: Array<{ payload: string; rowCount: number }> = [];
  let serializedRows: string[] = [];
  let payloadBytes = 2; // JSON array brackets

  const flush = () => {
    chunks.push({ payload: `[${serializedRows.join(',')}]`, rowCount: serializedRows.length });
    serializedRows = [];
    payloadBytes = 2;
  };

  for (const row of rows) {
    const serialized = JSON.stringify(row);
    const rowBytes = encoder.encode(serialized).byteLength;
    if (rowBytes + 2 > MAX_STAGING_PAYLOAD_BYTES) {
      throw new Error(`同步暂存单行超过 ${MAX_STAGING_PAYLOAD_BYTES} 字节，请检查源数据字段`);
    }
    if (payloadBytes + rowBytes + (serializedRows.length ? 1 : 0) > MAX_STAGING_PAYLOAD_BYTES) flush();
    serializedRows.push(serialized);
    payloadBytes += rowBytes + (serializedRows.length > 1 ? 1 : 0);
  }
  if (serializedRows.length || !chunks.length) flush();
  return chunks;
}
