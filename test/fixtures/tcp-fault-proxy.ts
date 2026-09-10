import { createServer, connect, Socket } from 'node:net';

// Test-owned loopback proxy. It never changes PostgreSQL or host firewall settings.
export async function createTcpFaultProxy(target: URL) {
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    !/^\/queue_e2e_[a-f0-9]{32}$/.test(target.pathname)
  ) {
    throw new Error(
      'TCP fault proxy requires an isolated local test database.',
    );
  }
  let blocked = false;
  let dropCommit = false;
  let droppedCommitResponses = 0;
  const sockets = new Set<Socket>();
  const cut = () => {
    blocked = true;
    for (const socket of sockets) socket.destroy();
  };
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
    return socket;
  };
  const server = createServer((client) => {
    track(client);
    if (blocked) return client.destroy();
    const upstream = track(
      connect({
        host: target.hostname.replaceAll('[', '').replaceAll(']', ''),
        port: Number(target.port || 5432),
      }),
    );
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
    client.pipe(upstream);
    // This test connection uses plaintext PostgreSQL (sslmode=disable).
    // Frame backend messages so fragmented/coalesced TCP packets cannot let a
    // COMMIT CommandComplete or its following ReadyForQuery reach the worker.
    let pending = Buffer.alloc(0);
    upstream.on('data', (data: Buffer) => {
      pending = Buffer.concat([pending, data]);
      while (pending.length >= 5) {
        const length = pending.readInt32BE(1);
        if (length < 4 || length > 64 * 1024 * 1024) {
          upstream.destroy(new Error('Invalid PostgreSQL backend frame'));
          return;
        }
        if (pending.length < length + 1) return;
        const frame = pending.subarray(0, length + 1);
        pending = pending.subarray(length + 1);
        if (
          dropCommit &&
          frame[0] === 0x43 &&
          frame.subarray(5).equals(Buffer.from('COMMIT\0'))
        ) {
          dropCommit = false;
          droppedCommitResponses++;
          cut();
          return;
        }
        client.write(frame);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing proxy address');
  const url = new URL(target);
  url.hostname = '127.0.0.1';
  url.port = String(address.port);
  url.searchParams.set('sslmode', 'disable');
  return {
    url,
    cut,
    dropNextCommitResponse() {
      dropCommit = true;
    },
    get droppedCommitResponses() {
      return droppedCommitResponses;
    },
    restore() {
      blocked = false;
      dropCommit = false;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
