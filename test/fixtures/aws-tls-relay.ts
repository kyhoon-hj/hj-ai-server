import { createServer, connect, Socket } from 'node:net';

// Opaque TLS forwarding: no headers, credentials, or plaintext are decoded or logged.
export async function createAwsTlsRelay(host: string) {
  if (
    !/^(s3|bedrock-runtime)\.(us|eu|ap|sa|ca|me|af|il|mx)-[a-z]+-\d\.amazonaws\.com$/.test(
      host,
    )
  )
    throw new Error('Only explicit regional AWS service hosts are allowed.');
  let mode: 'healthy' | 'cut' | 'stall' = 'healthy';
  const sockets = new Set<Socket>();
  const stats = { connections: 0, upstreamBytes: 0, faults: 0 };
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
    return socket;
  };
  const server = createServer((client) => {
    track(client);
    if (++stats.connections > 20) return client.destroy();
    const selected = mode;
    const remote = track(connect({ host, port: 443 }));
    remote.setTimeout(15000, () => remote.destroy());
    client.on('close', () => remote.destroy());
    remote.on('close', () => client.destroy());
    client.pipe(remote);
    if (selected === 'healthy') remote.pipe(client);
    let injected = false;
    remote.on('data', (data: Buffer) => {
      stats.upstreamBytes += data.length;
      if (selected !== 'healthy' && !injected) {
        injected = true;
        stats.faults++;
        if (selected === 'cut') {
          client.destroy();
          remote.destroy();
        }
        // stall consumes encrypted bytes without forwarding them until client timeout.
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing relay address');
  return {
    port: address.port,
    stats,
    setMode(next: typeof mode) {
      for (const socket of sockets) socket.destroy();
      mode = next;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
