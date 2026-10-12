import { defineScript } from './script-registry';

/** Observation Lua scripts; every multi-key write is scoped to one resource. */
export const claimScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local existing = redis.call('GET', KEYS[2])
if existing and existing ~= ARGV[2] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
return 1
`);
export const releaseScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1
`);
export const prepareScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] or redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
local purge = redis.call('HGET', KEYS[3], 'purge')
local disclosure = redis.call('HGET', KEYS[3], 'disclosure')
if purge and tonumber(purge) > tonumber(ARGV[3]) then return 0 end
if disclosure and tonumber(disclosure) > tonumber(ARGV[4]) then return 0 end
if not purge or purge ~= ARGV[3] or disclosure ~= ARGV[4] then redis.call('DEL', KEYS[4]) end
redis.call('HSET', KEYS[3], 'purge', ARGV[3], 'disclosure', ARGV[4], 'incarnation', ARGV[1])
redis.call('PEXPIRE', KEYS[3], ARGV[5])
return 1
`);
/** All body/head writes occur after all fences. No missing guard can be recreated here. */
export const publishScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local owner = redis.call('GET', KEYS[2])
if owner ~= ARGV[2] then return 0 end
if redis.call('HGET', KEYS[3], 'incarnation') ~= ARGV[1] or redis.call('HGET', KEYS[3], 'purge') ~= ARGV[3] or redis.call('HGET', KEYS[3], 'disclosure') ~= ARGV[4] then return 0 end
local previous = redis.call('HGET', KEYS[4], 'head:' .. ARGV[5])
if previous and tonumber(previous) >= tonumber(ARGV[6]) then return 0 end
if not previous and redis.call('HLEN', KEYS[4]) >= 128 then return -1 end
if previous then redis.call('HDEL', KEYS[4], 'body:' .. ARGV[5] .. ':' .. previous) end
redis.call('HSET', KEYS[4], 'body:' .. ARGV[5] .. ':' .. ARGV[6], ARGV[7], 'head:' .. ARGV[5], ARGV[6])
redis.call('PEXPIRE', KEYS[4], ARGV[8])
redis.call('PUBLISH', KEYS[5], ARGV[9])
return 1
`);
export const retainScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] or redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
if redis.call('HGET', KEYS[3], 'incarnation') ~= ARGV[1] or redis.call('HGET', KEYS[3], 'purge') ~= ARGV[3] or redis.call('HGET', KEYS[3], 'disclosure') ~= ARGV[4] then return 0 end
if redis.call('HGET', KEYS[4], 'head:' .. ARGV[5]) ~= ARGV[6] or redis.call('HEXISTS', KEYS[4], 'body:' .. ARGV[5] .. ':' .. ARGV[6]) == 0 then return 0 end
redis.call('PEXPIRE', KEYS[4], ARGV[7])
return 1
`);
export const purgeScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local purge = redis.call('HGET', KEYS[3], 'purge')
if purge and tonumber(purge) > tonumber(ARGV[2]) then return 0 end
local disclosure = redis.call('HGET', KEYS[3], 'disclosure')
if disclosure and tonumber(disclosure) > tonumber(ARGV[3]) then return 0 end
redis.call('DEL', KEYS[2], KEYS[4])
redis.call('HSET', KEYS[3], 'incarnation', ARGV[1], 'purge', ARGV[2], 'disclosure', ARGV[3])
redis.call('PEXPIRE', KEYS[3], ARGV[4])
redis.call('PUBLISH', KEYS[5], ARGV[5])
return 1
`);
const reapDemand = `
local rows = redis.call('HGETALL', KEYS[4])
for index = 1, #rows, 2 do
 local value = cjson.decode(rows[index + 1])
 if tonumber(value.expiresAt) <= now then
  redis.call('HDEL', KEYS[4], rows[index])
  local revision = redis.call('HGET', KEYS[5], 'head:' .. rows[index])
  if revision then redis.call('HDEL', KEYS[5], 'head:' .. rows[index], 'body:' .. rows[index] .. ':' .. revision) end
 end
end
`;
const reapBodies = `
local fields = redis.call('HKEYS', KEYS[5])
for _, field in ipairs(fields) do
 if string.sub(field, 1, 5) == 'head:' then
  local digest = string.sub(field, 6)
  if redis.call('HEXISTS', KEYS[4], digest) == 0 then
   local revision = redis.call('HGET', KEYS[5], field)
   redis.call('HDEL', KEYS[5], field, 'body:' .. digest .. ':' .. revision)
  end
 end
end
`;
export const interestScript = defineScript(`
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) and redis.call('ZCARD', KEYS[1]) >= 128 then return 0 end
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now, 'LIMIT', 0, 128)
for _, resource in ipairs(expired) do redis.call('ZREM', KEYS[2], resource); redis.call('ZREM', KEYS[3], resource) end
if not redis.call('ZSCORE', KEYS[2], ARGV[3]) and redis.call('ZCARD', KEYS[2]) >= 10000 then return 0 end
${reapDemand}
local added = 0
for index = 4, #ARGV, 2 do if redis.call('HEXISTS', KEYS[4], ARGV[index]) == 0 then added = added + 1 end end
if redis.call('HLEN', KEYS[4]) + added > 64 then return 0 end
for index = 4, #ARGV, 2 do redis.call('HSET', KEYS[4], ARGV[index], cjson.encode({base=cjson.decode(ARGV[index+1]),expiresAt=now+tonumber(ARGV[2])})) end
${reapBodies}
redis.call('PEXPIRE', KEYS[4], ARGV[2])
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
redis.call('ZADD', KEYS[2], 'NX', now, ARGV[3])
redis.call('ZADD', KEYS[3], now + tonumber(ARGV[2]), ARGV[3])
redis.call('PEXPIRE', KEYS[2], 60000)
redis.call('PEXPIRE', KEYS[3], 60000)
return 1
`);
export const readDemandScript = defineScript(`
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
${reapDemand}
${reapBodies}
local rows = redis.call('HVALS', KEYS[4])
local result = {}
for _, row in ipairs(rows) do table.insert(result, cjson.encode(cjson.decode(row).base)) end
return result
`);
export const discoverScript = defineScript(`
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now, 'LIMIT', 0, 128)
for _, resource in ipairs(expired) do redis.call('ZREM', KEYS[1], resource); redis.call('ZREM', KEYS[2], resource) end
local resources = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, ARGV[1])
local live = {}
for _, resource in ipairs(resources) do
 local expiry = redis.call('ZSCORE', KEYS[2], resource)
 if expiry and tonumber(expiry) > now then
  table.insert(live, resource); redis.call('ZADD', KEYS[1], now + 500, resource)
 else redis.call('ZREM', KEYS[1], resource); redis.call('ZREM', KEYS[2], resource) end
end
return live
`);
export const readScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return {} end
local result = {}
for index = 2, #ARGV do
 local revision = redis.call('HGET', KEYS[2], 'head:' .. ARGV[index])
 local body = revision and redis.call('HGET', KEYS[2], 'body:' .. ARGV[index] .. ':' .. revision)
 table.insert(result, {revision or false, body or false})
end
return result
`);
