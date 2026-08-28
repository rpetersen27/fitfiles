import type { RecordedSession, SessionRecord } from "./session-recorder.js";

interface FieldDefinition {
  number: number;
  size: number;
  baseType: number;
}

const FIT_EPOCH_SECONDS = 631065600;
const INVALID_UINT8 = 0xff;
const INVALID_UINT16 = 0xffff;
const INVALID_UINT32 = 0xffffffff;

function fitTimestamp(milliseconds: number): number {
  return Math.max(0, Math.floor(milliseconds / 1000) - FIT_EPOCH_SECONDS);
}

function uint16(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}

function uint32(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function definition(
  bytes: number[],
  localMessage: number,
  globalMessage: number,
  fields: FieldDefinition[]
): void {
  bytes.push(0x40 | localMessage, 0, 0);
  uint16(bytes, globalMessage);
  bytes.push(fields.length);
  for (const field of fields) bytes.push(field.number, field.size, field.baseType);
}

function crc16(data: Uint8Array): number {
  const table = [
    0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
    0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400
  ];
  let crc = 0;
  for (const byte of data) {
    let temporary = table[crc & 0xf] ?? 0;
    crc = ((crc >> 4) & 0x0fff) ^ temporary ^ (table[byte & 0xf] ?? 0);
    temporary = table[crc & 0xf] ?? 0;
    crc = ((crc >> 4) & 0x0fff) ^ temporary ^ (table[(byte >> 4) & 0xf] ?? 0);
  }
  return crc;
}

function validValues(records: SessionRecord[], field: "heartRate" | "cadence" | "power" | "speed"): number[] {
  return records.map((record) => record[field]).filter((value): value is number => value != null);
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function scaled(value: number | null, scale: number, invalid: number, maximum: number): number {
  return value == null ? invalid : Math.min(maximum, Math.max(0, Math.round(value * scale)));
}

export function createFitFile(session: RecordedSession): Blob {
  const data: number[] = [];

  definition(data, 0, 0, [
    { number: 0, size: 1, baseType: 0x00 },
    { number: 1, size: 2, baseType: 0x84 },
    { number: 2, size: 2, baseType: 0x84 },
    { number: 3, size: 4, baseType: 0x8c },
    { number: 4, size: 4, baseType: 0x86 }
  ]);
  data.push(0, 4);
  uint16(data, 255);
  uint16(data, 0);
  uint32(data, 1);
  uint32(data, fitTimestamp(session.startedAt));

  definition(data, 1, 20, [
    { number: 253, size: 4, baseType: 0x86 },
    { number: 3, size: 1, baseType: 0x02 },
    { number: 4, size: 1, baseType: 0x02 },
    { number: 5, size: 4, baseType: 0x86 },
    { number: 6, size: 2, baseType: 0x84 },
    { number: 7, size: 2, baseType: 0x84 }
  ]);
  definition(data, 2, 21, [
    { number: 253, size: 4, baseType: 0x86 },
    { number: 0, size: 1, baseType: 0x00 },
    { number: 1, size: 1, baseType: 0x00 }
  ]);

  const timeline = [
    ...session.records.map((record) => ({ timestamp: record.timestamp, record })),
    ...session.events.map((event) => ({ timestamp: event.timestamp, event }))
  ].sort((a, b) => a.timestamp - b.timestamp || ("event" in a ? -1 : 1));

  for (const item of timeline) {
    if ("record" in item) {
      const record = item.record;
      data.push(1);
      uint32(data, fitTimestamp(record.timestamp));
      data.push(scaled(record.heartRate ?? null, 1, INVALID_UINT8, 254));
      data.push(scaled(record.cadence ?? null, 1, INVALID_UINT8, 254));
      uint32(data, scaled(record.distance, 100, INVALID_UINT32, 0xfffffffe));
      uint16(data, scaled(record.speed != null ? record.speed / 3.6 : null, 1000, INVALID_UINT16, 0xfffe));
      uint16(data, scaled(record.power ?? null, 1, INVALID_UINT16, 0xfffe));
    } else {
      data.push(2);
      uint32(data, fitTimestamp(item.event.timestamp));
      data.push(0, item.event.type === "start" ? 0 : 4);
    }
  }

  const summaryFields: FieldDefinition[] = [
    { number: 254, size: 2, baseType: 0x84 },
    { number: 253, size: 4, baseType: 0x86 },
    { number: 2, size: 4, baseType: 0x86 },
    { number: 7, size: 4, baseType: 0x86 },
    { number: 8, size: 4, baseType: 0x86 },
    { number: 9, size: 4, baseType: 0x86 },
    { number: 13, size: 2, baseType: 0x84 },
    { number: 15, size: 1, baseType: 0x02 },
    { number: 16, size: 1, baseType: 0x02 },
    { number: 17, size: 1, baseType: 0x02 },
    { number: 18, size: 1, baseType: 0x02 },
    { number: 19, size: 2, baseType: 0x84 },
    { number: 20, size: 2, baseType: 0x84 }
  ];
  definition(data, 3, 19, summaryFields);

  const starts = session.sectionStarts.length > 0 ? session.sectionStarts : [0];
  starts.forEach((startIndex, sectionIndex) => {
    const endIndex = starts[sectionIndex + 1] ?? session.records.length;
    const records = session.records.slice(startIndex, endIndex);
    const first = records[0] ?? session.records[0];
    const last = records.at(-1) ?? first;
    if (!first || !last) return;
    const elapsed = Math.max(0, (last.timestamp - first.timestamp) / 1000);
    const timer = Math.max(0, last.timerTime - first.timerTime);
    const distance = Math.max(0, last.distance - first.distance);
    const heartRates = validValues(records, "heartRate");
    const cadences = validValues(records, "cadence");
    const powers = validValues(records, "power");
    data.push(3);
    uint16(data, sectionIndex);
    uint32(data, fitTimestamp(last.timestamp));
    uint32(data, fitTimestamp(first.timestamp));
    uint32(data, Math.round(elapsed * 1000));
    uint32(data, Math.round(timer * 1000));
    uint32(data, Math.round(distance * 100));
    uint16(data, scaled(timer > 0 ? distance / timer : null, 1000, INVALID_UINT16, 0xfffe));
    data.push(scaled(average(heartRates), 1, INVALID_UINT8, 254));
    data.push(scaled(heartRates.length ? Math.max(...heartRates) : null, 1, INVALID_UINT8, 254));
    data.push(scaled(average(cadences), 1, INVALID_UINT8, 254));
    data.push(scaled(cadences.length ? Math.max(...cadences) : null, 1, INVALID_UINT8, 254));
    uint16(data, scaled(average(powers), 1, INVALID_UINT16, 0xfffe));
    uint16(data, scaled(powers.length ? Math.max(...powers) : null, 1, INVALID_UINT16, 0xfffe));
  });

  definition(data, 4, 18, [
    { number: 253, size: 4, baseType: 0x86 }, { number: 2, size: 4, baseType: 0x86 },
    { number: 5, size: 1, baseType: 0x00 }, { number: 6, size: 1, baseType: 0x00 },
    { number: 7, size: 4, baseType: 0x86 }, { number: 8, size: 4, baseType: 0x86 },
    { number: 9, size: 4, baseType: 0x86 }, { number: 14, size: 2, baseType: 0x84 },
    { number: 16, size: 1, baseType: 0x02 }, { number: 17, size: 1, baseType: 0x02 },
    { number: 18, size: 1, baseType: 0x02 }, { number: 19, size: 1, baseType: 0x02 },
    { number: 20, size: 2, baseType: 0x84 }, { number: 21, size: 2, baseType: 0x84 },
    { number: 26, size: 2, baseType: 0x84 }
  ]);
  const hrs = validValues(session.records, "heartRate");
  const cads = validValues(session.records, "cadence");
  const powers = validValues(session.records, "power");
  data.push(4);
  uint32(data, fitTimestamp(session.stoppedAt)); uint32(data, fitTimestamp(session.startedAt));
  data.push(2, 6);
  uint32(data, Math.round((session.stoppedAt - session.startedAt)));
  uint32(data, Math.round(session.totalTimerTime * 1000));
  uint32(data, Math.round(session.distance * 100));
  uint16(data, scaled(session.totalTimerTime > 0 ? session.distance / session.totalTimerTime : null, 1000, INVALID_UINT16, 0xfffe));
  data.push(scaled(average(hrs), 1, INVALID_UINT8, 254), scaled(hrs.length ? Math.max(...hrs) : null, 1, INVALID_UINT8, 254));
  data.push(scaled(average(cads), 1, INVALID_UINT8, 254), scaled(cads.length ? Math.max(...cads) : null, 1, INVALID_UINT8, 254));
  uint16(data, scaled(average(powers), 1, INVALID_UINT16, 0xfffe));
  uint16(data, scaled(powers.length ? Math.max(...powers) : null, 1, INVALID_UINT16, 0xfffe));
  uint16(data, starts.length);

  definition(data, 5, 34, [
    { number: 253, size: 4, baseType: 0x86 }, { number: 0, size: 4, baseType: 0x86 },
    { number: 1, size: 2, baseType: 0x84 }, { number: 2, size: 1, baseType: 0x00 },
    { number: 3, size: 1, baseType: 0x00 }, { number: 4, size: 1, baseType: 0x00 }
  ]);
  data.push(5); uint32(data, fitTimestamp(session.stoppedAt));
  uint32(data, Math.round(session.totalTimerTime * 1000)); uint16(data, 1);
  data.push(0, 26, 1);

  const header = new Uint8Array(14);
  const headerView = new DataView(header.buffer);
  header[0] = 14; header[1] = 0x20;
  headerView.setUint16(2, 2200, true); headerView.setUint32(4, data.length, true);
  header.set([0x2e, 0x46, 0x49, 0x54], 8);
  headerView.setUint16(12, crc16(header.slice(0, 12)), true);
  const withoutCrc = new Uint8Array(header.length + data.length);
  withoutCrc.set(header); withoutCrc.set(data, header.length);
  const output = new Uint8Array(withoutCrc.length + 2);
  output.set(withoutCrc);
  new DataView(output.buffer).setUint16(withoutCrc.length, crc16(withoutCrc), true);
  return new Blob([output], { type: "application/octet-stream" });
}
