// Boot the real server and exercise the v1 API over HTTP with a real key.
process.env.REDIS_URL=''; process.env.OMNIDIM_API_KEY='test-key-not-real';
process.env.DATA_DIR=require('os').tmpdir()+'/omni-boot-'+Date.now();
process.env.PORT='4821'; process.env.NODE_ENV='test'; delete process.env.VERCEL;
process.env.ADMIN_EMAIL='admin@example.test'; process.env.ADMIN_PASSWORD='synthetic-admin-pw-123';
const db=require('../db.js');
require('../server.js');
const base='http://127.0.0.1:4821';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  await sleep(1200);
  const u=db.createUser({email:'apiuser@example.test',password:'synthetic-pw-12345',org:'API Test Org',status:'active'});
  const good=db.createApiKey(u.id,{name:'boot',scopes:['calls:read','agents:read']});
  const noScope=db.createApiKey(u.id,{name:'narrow',scopes:['contacts:read']});
  const revoked=db.createApiKey(u.id,{name:'dead',scopes:['calls:read']});
  db.revokeApiKey(revoked.record.id,u.id);

  const hit=async(p,o={})=>{const r=await fetch(base+p,o);let j={};try{j=await r.json()}catch(e){}return{s:r.status,j};};
  const results=[];
  const check=(name,cond,extra='')=>results.push((cond?'PASS':'FAIL')+'  '+name+(extra?'  '+extra:''));

  let r=await hit('/api/v1/ping');
  check('no key -> 401 missing_credentials', r.s===401 && r.j.error.code==='missing_credentials', 'got '+r.s);

  r=await hit('/api/v1/ping',{headers:{Authorization:'Bearer '+good.secret}});
  check('valid key -> 200 + scopes echoed', r.s===200 && r.j.key.scopes.includes('calls:read'), 'got '+r.s);

  r=await hit('/api/v1/ping',{headers:{'X-API-Key':good.secret}});
  check('X-API-Key header also works', r.s===200, 'got '+r.s);

  r=await hit('/api/v1/ping',{headers:{Authorization:'Bearer mnb_sk_'+'0'.repeat(16)+'_'+'a'.repeat(64)}});
  check('unknown key -> 401 invalid_key', r.s===401 && r.j.error.code==='invalid_key', 'got '+r.s);

  r=await hit('/api/v1/ping',{headers:{Authorization:'Bearer '+revoked.secret}});
  check('revoked key -> 401', r.s===401, 'got '+r.s);

  r=await hit('/api/v1/calls',{headers:{Authorization:'Bearer '+noScope.secret}});
  check('wrong scope -> 403 insufficient_scope', r.s===403 && r.j.error.code==='insufficient_scope', 'got '+r.s);

  r=await hit('/api/v1/ping?api_key='+good.secret);
  check('key in query -> 400 key_in_query', r.s===400 && r.j.error.code==='key_in_query', 'got '+r.s);

  r=await hit('/api/v1/nope',{headers:{Authorization:'Bearer '+good.secret}});
  check('unknown v1 path -> 404 (no fallthrough)', r.s===404 && r.j.error.code==='unknown_endpoint', 'got '+r.s);

  r=await hit('/api/v1/calls',{method:'POST',headers:{Authorization:'Bearer '+good.secret,'Content-Type':'application/json'},body:JSON.stringify({agent_id:1,to_number:'+919999999999'})});
  check('calls:write missing -> 403', r.s===403, 'got '+r.s);

  r=await hit('/api/v1-openapi.json');
  check('OpenAPI spec public + valid', r.s===200 && r.j.openapi==='3.0.3' && !!r.j.paths['/calls'], 'got '+r.s);

  r=await hit('/api/keys');
  check('dashboard /api/keys needs session -> 401', r.s===401, 'got '+r.s);

  console.log('\n'+results.join('\n'));
  console.log('\n'+results.filter(x=>x.startsWith('PASS')).length+'/'+results.length+' passed');
  process.exit(results.some(x=>x.startsWith('FAIL'))?1:0);
})();
