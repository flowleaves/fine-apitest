/**
 * SSE 解码器：支持拆包、多行 data、CRLF、UTF-8 字节边界与注释心跳。
 *
 * 不把「只收到心跳」当成功；完成信号由调用方判断。
 */
export class SseDecoder {
  constructor() {
    this.decoder = new TextDecoder('utf-8');
    this.buffer = '';
    this.eventName = null;
    this.dataLines = [];
    this.lastId = null;
    this.retry = null;
    this.gotAny = false;
  }

  get sawBytes() {
    return this.gotAny;
  }

  push(chunk) {
    this.gotAny = true;
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain();
  }

  end() {
    this.buffer += this.decoder.decode();
    const out = this.drain();
    // 流结束时可能没有末尾换行：把残余的最后一行也处理掉，再冲刷事件。
    if (this.buffer) {
      let line = this.buffer;
      this.buffer = '';
      if (line.endsWith('\r')) line = line.slice(0, -1);
      const msg = this.handleLine(line);
      if (msg) out.push(msg);
    }
    const last = this.flushEvent();
    if (last) out.push(last);
    return out;
  }

  drain() {
    const out = [];
    for (;;) {
      const nl = this.buffer.indexOf('\n');
      if (nl < 0) break;
      let line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      const msg = this.handleLine(line);
      if (msg) out.push(msg);
    }
    return out;
  }

  handleLine(line) {
    if (line === '') return this.flushEvent();
    if (line.startsWith(':')) {
      return { event: null, data: '', id: null, retry: null, comment: true };
    }
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event':
        this.eventName = value;
        break;
      case 'data':
        this.dataLines.push(value);
        break;
      case 'id':
        if (!value.includes('\0')) this.lastId = value;
        break;
      case 'retry': {
        const n = Number(value);
        if (Number.isFinite(n)) this.retry = n;
        break;
      }
      default:
        break;
    }
    return null;
  }

  flushEvent() {
    if (this.dataLines.length === 0 && this.eventName === null) return null;
    const msg = {
      event: this.eventName,
      data: this.dataLines.join('\n'),
      id: this.lastId,
      retry: this.retry,
      comment: false,
    };
    this.eventName = null;
    this.dataLines = [];
    return msg;
  }
}
