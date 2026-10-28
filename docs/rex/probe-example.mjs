import WebSocket from 'ws';
import fs from 'node:fs';

const sock = '/run/user/1000/rex/server.sock';
const sessionId = process.argv[2];
const blockId = process.argv[3];

const ctl = new WebSocket(`ws+unix://${sock}:/api/control`, 'rex.control.v1');
let n = 0;
const pending = new Map();
const call = (method, payload) => new Promise((res, rej) => {
  const id = String(++n);
  pending.set(id, { res, rej });
  ctl.send(JSON.stringify({ type: 'request', id, method, payload }));
});

ctl.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === 'welcome') { console.log('WELCOME', JSON.stringify(m)); return go(); }
  if (m.type === 'response') {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(m.error) : p.res(m.payload);
  } else if (m.type === 'event') console.log('EVENT', JSON.stringify(m.payload).slice(0, 300));
});
ctl.on('open', () => ctl.send(JSON.stringify({ type: 'hello', api_revision: 7, client: { kind: 'app', name: 'rex-gui-probe', version: '0.0.1' } })));

async function go() {
  const att = await call('session.attach', { session_id: sessionId });
  console.log('ATTACH', JSON.stringify(att).slice(0, 1500));
  const { ticket } = await call('data.connect', { session_id: sessionId, block_id: blockId, data_ref_id: 'terminal', subprotocol: 'rex.data.terminal.v1' });
  const data = new WebSocket(`ws+unix://${sock}:/api/data`, 'rex.data.terminal.v1', { perMessageDeflate: false });
  const chunks = [];
  data.on('open', () => data.send(Buffer.concat([Buffer.from([1]), Buffer.from(ticket, 'base64url')])));
  let welcomed = false;
  data.on('message', (buf) => {
    if (!welcomed) {
      welcomed = true;
      console.log('DATA HS', buf.length, buf.toString('hex'));
      if (buf[0] === 0x81) console.log('nonce', buf.readBigUInt64LE(24).toString());
      return;
    }
    chunks.push(buf);
  });
  setTimeout(async () => {
    await call('com.superlogical.terminal.write', { session_id: sessionId, block_id: blockId, args: { data: 'echo hi from probe\n' } });
  }, 500);
  setTimeout(() => {
    fs.writeFileSync('/tmp/rexprobe/stream.bin', Buffer.concat(chunks));
    console.log('bytes', Buffer.concat(chunks).length);
    process.exit(0);
  }, 2000);
}
