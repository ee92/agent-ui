import { createHash } from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encodeFrame(data, opcode = 0x1) {
  const payload = Buffer.from(data);
  const length = payload.length;

  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

function tryDecodeFrame(buffer) {
  if (buffer.length < 2) {
    return null;
  }

  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let payloadLen = second & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    payloadLen = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLen === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }
    const bigLen = buffer.readBigUInt64BE(offset);
    payloadLen = Number(bigLen);
    offset += 8;
  }

  const maskLen = masked ? 4 : 0;
  const frameLen = offset + maskLen + payloadLen;
  if (buffer.length < frameLen) {
    return null;
  }

  let payload = buffer.subarray(offset + maskLen, frameLen);
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    const unmasked = Buffer.alloc(payload.length);
    for (let index = 0; index < payload.length; index += 1) {
      unmasked[index] = payload[index] ^ mask[index % 4];
    }
    payload = unmasked;
  }

  return {
    frame: { opcode, payload },
    nextOffset: frameLen,
  };
}

function websocketAccept(key) {
  return createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
}

function sendJson(socket, payload) {
  if (socket.destroyed) {
    return;
  }
  socket.write(encodeFrame(JSON.stringify(payload)));
}

export function createBroker() {
  const clients = new Map();
  let clientIdSeed = 0;

  function addClient({ req, socket, head }) {
    const wsKey = req.headers["sec-websocket-key"];
    if (typeof wsKey !== "string") {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const accept = websocketAccept(wsKey);
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n",
      ].join("\r\n")
    );

    const client = {
      id: `ws-${++clientIdSeed}`,
      socket,
      subscriptions: new Set(),
      buffer: Buffer.alloc(0),
    };

    clients.set(client.id, client);

    const removeClient = () => {
      clients.delete(client.id);
      if (!socket.destroyed) {
        socket.destroy();
      }
    };

    const processTextMessage = (text) => {
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        return;
      }

      if (payload?.type === "subscribe" && typeof payload.sessionKey === "string") {
        client.subscriptions.add(payload.sessionKey);
        return;
      }

      if (payload?.type === "unsubscribe" && typeof payload.sessionKey === "string") {
        client.subscriptions.delete(payload.sessionKey);
        return;
      }

      if (payload?.type === "ping") {
        sendJson(socket, { type: "pong", ts: payload.ts ?? Date.now() });
      }
    };

    const consume = (chunk) => {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      while (client.buffer.length > 0) {
        const decoded = tryDecodeFrame(client.buffer);
        if (!decoded) {
          break;
        }

        client.buffer = client.buffer.subarray(decoded.nextOffset);

        if (decoded.frame.opcode === 0x8) {
          removeClient();
          return;
        }

        if (decoded.frame.opcode === 0x9) {
          socket.write(encodeFrame(decoded.frame.payload, 0xA));
          continue;
        }

        if (decoded.frame.opcode === 0x1) {
          processTextMessage(decoded.frame.payload.toString("utf8"));
        }
      }
    };

    socket.on("data", consume);
    socket.on("error", removeClient);
    socket.on("close", removeClient);

    if (head && head.length > 0) {
      consume(head);
    }
  }

  function publish(event) {
    for (const client of clients.values()) {
      const wantsAll = client.subscriptions.has("*");
      const wantsSession =
        typeof event.sessionKey === "string" && client.subscriptions.has(event.sessionKey);
      if (!wantsAll && !wantsSession && event.sessionKey) {
        continue;
      }
      sendJson(client.socket, event);
    }
  }

  return {
    addClient,
    publish,
  };
}
