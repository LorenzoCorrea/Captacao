import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.TZ = 'America/Sao_Paulo';
delete process.env.DATABASE_URL;
process.env.ENRICH_BACKGROUND = 'false';
const { isPrivateIp, safeLookup, postJsonPublic } = await import('../src/routes/search.js');
const { hojeLocal } = await import('../src/date.js');

test('classifica endereços internos e públicos', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '100.64.0.1', '192.168.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd7a:115c::1', 'fe90::1', '224.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test('nome que resolve para IP interno é recusado na conexão', async () => {
  await assert.rejects(new Promise((resolve, reject) => {
    safeLookup('localhost', {}, (err, addr) => (err ? reject(err) : resolve(addr)));
  }), /interno/);
});

test('webhook não segue redirecionamento', async () => {
  let hitInternal = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/interno') { hitInternal = true; return res.end('ok'); }
    res.writeHead(302, { Location: '/interno' }).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const r = await postJsonPublic(`http://127.0.0.1:${server.address().port}/`, { a: 1 });
    assert.deepEqual(r, { ok: false, status: 302 });
    assert.equal(hitInternal, false);
  } finally {
    server.close();
  }
});

test('às 21h30 no Brasil ainda é o mesmo dia', () => {
  assert.equal(hojeLocal(new Date('2026-11-05T00:30:00Z')), '2026-11-04');
});
