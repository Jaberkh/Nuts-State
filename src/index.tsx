import { serveStatic } from "@hono/node-server/serve-static";
import { Button, Frog } from 'frog';
import { serve } from "@hono/node-server";
import { neynar } from 'frog/middlewares';
import fs from 'fs/promises';

const cacheFile = './cache.json';
let cache: {
  queries: Record<string, { rows: any[]; lastUpdated: number }>;
  initialFetchDone: boolean;
  updateCountToday: number;
  lastUpdateDay: number;
} = {
  queries: {
    '4837362': { rows: [], lastUpdated: 0 }
  },
  initialFetchDone: false,
  updateCountToday: 0,
  lastUpdateDay: 0
};

const secondTimestamps: number[] = [];
const minuteTimestamps: number[] = [];
const MAX_RPS = 5;
const MAX_RPM = 300;
const LOAD_THRESHOLD = 4;
const SECOND_DURATION = 1000;
const MINUTE_DURATION = 60000;
let isUpdating = false;
let apiRequestCount = 0;

function checkRateLimit(): { isAllowed: boolean; isLoading: boolean } {
  const now = Date.now();
  while (secondTimestamps.length > 0 && now - secondTimestamps[0] > SECOND_DURATION) {
    secondTimestamps.shift();
  }
  while (minuteTimestamps.length > 0 && now - minuteTimestamps[0] > MINUTE_DURATION) {
    minuteTimestamps.shift();
  }
  if (secondTimestamps.length >= MAX_RPS || minuteTimestamps.length >= MAX_RPM) {
    console.log('[RateLimit] Too many requests. RPS:', secondTimestamps.length, 'RPM:', minuteTimestamps.length);
    return { isAllowed: false, isLoading: false };
  }
  if (secondTimestamps.length >= LOAD_THRESHOLD) {
    console.log('[RateLimit] Approaching limit. Switching to loading state. RPS:', secondTimestamps.length);
    return { isAllowed: true, isLoading: true };
  }
  secondTimestamps.push(now);
  minuteTimestamps.push(now);
  console.log('[RateLimit] Allowed. RPS Remaining:', MAX_RPS - secondTimestamps.length, 'RPM Remaining:', MAX_RPM - minuteTimestamps.length);
  return { isAllowed: true, isLoading: false };
}

async function loadCache() {
  console.log('[Cache] Loading cache from file');
  try {
    const data = await fs.readFile(cacheFile, 'utf8');
    const loadedCache = JSON.parse(data);
    cache = {
      queries: {
        '4837362': loadedCache.queries['4837362'] || { rows: [], lastUpdated: 0 }
      },
      initialFetchDone: loadedCache.initialFetchDone || false,
      updateCountToday: loadedCache.updateCountToday || 0,
      lastUpdateDay: loadedCache.lastUpdateDay || 0
    };
    console.log(`[Cache] Loaded: initialFetchDone=${cache.initialFetchDone}, updateCountToday=${cache.updateCountToday}, lastUpdateDay=${new Date(cache.lastUpdateDay).toUTCString()}`);
  } catch (error) {
    console.log('[Cache] No cache file found or invalid JSON. Starting fresh');
  }
}

async function saveCache() {
  console.log('[Cache] Saving cache to file');
  await fs.writeFile(cacheFile, JSON.stringify(cache, null, 2));
  console.log('[Cache] Cache saved');
  if (cache.queries['4837362'].rows.length === 0) {
    console.warn('[Cache] Warning: Cache saved with 0 rows');
  } else {
    console.log(`[Cache] Cache saved with ${cache.queries['4837362'].rows.length} rows`);
  }
}

console.log('[Server] Initializing cache');
loadCache().then(() => console.log('[Server] Cache initialized'));

export const app = new Frog({
  title: 'Nut State',
  imageOptions: { fonts: [{ name: 'Poetsen One', weight: 400, source: 'google' }] },
});

app.use(neynar({ apiKey: 'NEYNAR_FROG_FM', features: ['interactor', 'cast'] }));
app.use('/*', serveStatic({ root: './public' }));

async function executeQuery(queryId: string): Promise<string | null> {
  console.log(`[API] Executing Query ${queryId} (Request #${++apiRequestCount})`);
  try {
    const response = await fetch(`https://api.dune.com/api/v1/query/${queryId}/execute`, {
      method: 'POST',
      headers: { 'X-Dune-API-Key': 'CoMMnwtezMe3cVDY8WC7tLkJpTtlE4JX' }
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    const data = await response.json();
    const executionId = data.execution_id;
    console.log(`[API] Query ${queryId} execution started with ID: ${executionId}`);
    return executionId;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[API] Error executing Query ${queryId}:`, errorMessage);
    return null;
  }
}

async function fetchQueryResult(executionId: string, queryId: string) {
  console.log(`[API] Fetching results for Query ${queryId} with execution ID ${executionId} (Request #${++apiRequestCount})`);
  try {
    const response = await fetch(`https://api.dune.com/api/v1/execution/${executionId}/results`, {
      method: 'GET',
      headers: { 'X-Dune-API-Key': 'CoMMnwtezMe3cVDY8WC7tLkJpTtlE4JX' }
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    const data = await response.json();
    console.log(`[API] Full response for Query ${queryId}:`, JSON.stringify(data));
    if (data.state === 'EXECUTING' || data.state === 'PENDING') {
      console.log(`[API] Query ${queryId} still executing or pending. Results not ready yet.`);
      return null;
    }
    const results = data?.result?.rows || [];
    console.log(`[API] Fetched ${results.length} rows for Query ${queryId}`);
    return results;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[API] Error fetching Query ${queryId}:`, errorMessage);
    return [];
  }
}

function generateHashId(fid: string): string {
  console.log(`[Hash] Generating hashId for FID ${fid}`);
  const timestamp = Date.now();
  const randomHash = Math.random().toString(36).substr(2, 9);
  const hashId = `${timestamp}-${fid}-${randomHash}`;
  console.log(`[Hash] Generated hashId: ${hashId}`);
  return hashId;
}

const hashIdCache: Record<string, string> = {};

async function getOrGenerateHashId(fid: string): Promise<string> {
  console.log(`[Hash] Checking hashId for FID ${fid}`);
  if (hashIdCache[fid]) {
    console.log(`[Hash] Using cached hashId: ${hashIdCache[fid]}`);
    return hashIdCache[fid];
  }
  const newHashId = generateHashId(fid);
  hashIdCache[fid] = newHashId;
  console.log(`[Hash] New hashId stored: ${newHashId}`);
  return newHashId;
}

function getCurrentUTCDay() {
  console.log('[Time] Calculating current UTC day');
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
  console.log(`[Time] Current UTC day start: ${new Date(dayStart).toUTCString()}`);
  return dayStart;
}

function shouldUpdateApi(lastUpdated: number) {
  console.log('[UpdateCheck] Checking if API update is allowed');
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const totalMinutes = utcHours * 60 + utcMinutes;
  const updateTimes = [180, 369, 605, 1080, 1260]; // 3:00, 6:09, 10:05, 18:00, 21:00 UTC
  const closestUpdateTime = updateTimes.find(time => Math.abs(totalMinutes - time) <= 5);
  if (!closestUpdateTime) {
    console.log(`[UpdateCheck] Current time: ${utcHours}:${utcMinutes} UTC, Not in update window`);
    return false;
  }
  const lastUpdateMinutes = new Date(lastUpdated).getUTCHours() * 60 + new Date(lastUpdated).getUTCMinutes();
  const alreadyUpdatedInWindow = Math.abs(lastUpdateMinutes - closestUpdateTime) <= 5;
  if (alreadyUpdatedInWindow) {
    console.log(`[UpdateCheck] Current time: ${utcHours}:${utcMinutes} UTC, Already updated in this window (${closestUpdateTime} minutes)`);
    return false;
  }
  console.log(`[UpdateCheck] Current time: ${utcHours}:${utcMinutes} UTC, Should update for ${closestUpdateTime} minutes`);
  return true;
}

async function updateQueries() {
  if (isUpdating) {
    console.log('[Update] Update already in progress. Skipping');
    return;
  }
  isUpdating = true;
  try {
    console.log('[Update] Entering updateQueries');
    const now = Date.now();
    const currentDay = getCurrentUTCDay();
    const queryId = '4837362';
    const lastUpdated = cache.queries[queryId].lastUpdated;
    const isCacheEmpty = cache.queries[queryId].rows.length === 0;
    console.log(`[Update] Last updated: ${new Date(lastUpdated).toUTCString()}, Initial Fetch Done: ${cache.initialFetchDone}, Update Count: ${cache.updateCountToday}, Last Update Day: ${new Date(cache.lastUpdateDay).toUTCString()}, Cache Empty: ${isCacheEmpty}`);

    if (cache.lastUpdateDay < currentDay) {
      console.log('[Update] New day detected. Resetting update count');
      cache.updateCountToday = 0;
      cache.lastUpdateDay = currentDay;
    }

    if (cache.updateCountToday >= 6) {
      console.log('[Update] Max 6 updates reached for today. Skipping');
      return;
    }

    if (!cache.initialFetchDone || isCacheEmpty) {
      console.log(`[Update] ${!cache.initialFetchDone ? 'First request' : 'Cache is empty'}. Forcing update at ${new Date().toUTCString()}`);
      const executionId = await executeQuery(queryId);
      if (!executionId) {
        console.error('[Update] Failed to get execution ID. Aborting update');
        return;
      }
      console.log('[Update] Waiting 3 minutes for query execution to complete');
      await new Promise(resolve => setTimeout(resolve, 180000)); // 3 دقیقه صبر
      const rows = await fetchQueryResult(executionId, queryId);
      if (rows === null) {
        console.warn('[Update] Results not ready after 3 minutes. Aborting');
        return;
      }
      if (rows.length === 0) {
        console.warn('[Update] No rows fetched from API despite expecting data');
      }
      cache.queries[queryId].rows = [];
      console.log('[Update] Cleared old cache rows before update');
      cache.queries[queryId] = { rows, lastUpdated: now };
      cache.initialFetchDone = true;
      cache.updateCountToday += 1;
      cache.lastUpdateDay = currentDay;
      await saveCache();
      console.log('[Update] Fetch completed due to initial fetch or empty cache');
      return;
    }

    if (!shouldUpdateApi(lastUpdated)) {
      console.log('[Update] Not an update time. Skipping');
      return;
    }

    console.log(`[Update] Scheduled update at ${new Date().toUTCString()}`);
    const executionId = await executeQuery(queryId);
    if (!executionId) {
      console.error('[Update] Failed to get execution ID. Aborting update');
      return;
    }
    console.log('[Update] Waiting 3 minutes for query execution to complete');
    await new Promise(resolve => setTimeout(resolve, 180000)); // 3 دقیقه صبر
    const rows = await fetchQueryResult(executionId, queryId);
    if (rows === null) {
      console.warn('[Update] Results not ready after 3 minutes. Aborting');
      return;
    }
    if (rows.length === 0) {
      console.warn('[Update] No rows fetched from API despite expecting data');
    }
    cache.queries[queryId].rows = [];
    console.log('[Update] Cleared old cache rows before update');
    cache.queries[queryId] = { rows, lastUpdated: now };
    cache.updateCountToday += 1;
    cache.lastUpdateDay = currentDay;
    await saveCache();
    console.log('[Update] Scheduled update completed');
  } finally {
    isUpdating = false;
  }
}

function scheduleUpdates() {
  setInterval(async () => {
    console.log('[Scheduler] Checking for scheduled update');
    await updateQueries();
  }, 5 * 60 * 1000); // هر 5 دقیقه چک می‌کنه
}

console.log('[Server] Starting update scheduler');
scheduleUpdates();

function getUserDataFromCache(fid: string) {
  console.log(`[Data] Fetching data from cache for FID ${fid}`);
  const userData = cache.queries['4837362'].rows.find((row: any) => row.fid == fid || row.parent_fid == fid) || {};
  const todayPeanutCount = userData.daily_peanut_count || 0;
  const totalPeanutCount = userData.all_time_peanut_count || 0;
  const sentPeanutCount = userData.sent_peanut_count || 0;
  const remainingAllowance = Math.max(30 - sentPeanutCount, 0);
  const userRank = userData.rank || 0;
  console.log(`[Data] FID ${fid} - Today: ${todayPeanutCount}, Total: ${totalPeanutCount}, Sent: ${sentPeanutCount}, Allowance: ${remainingAllowance}, Rank: ${userRank}`);
  return { todayPeanutCount, totalPeanutCount, sentPeanutCount, remainingAllowance, userRank };
}

app.frame('/', async (c) => {
  console.log(`[Frame] Request received at ${new Date().toUTCString()}`);
  console.log('[Frame] User-Agent:', c.req.header('user-agent'));
  const rateLimitStatus = checkRateLimit();
  if (!rateLimitStatus.isAllowed) {
    return c.res({
      image: (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%', backgroundColor: '#ffcccc' }}>
          <p style={{ color: '#ff0000', fontSize: '30px', fontFamily: 'Poetsen One' }}>Too many requests. Wait a moment.</p>
        </div>
      ),
      intents: [<Button value="my_state">Try Again</Button>]
    });
  }
  if (rateLimitStatus.isLoading) {
    return c.res({
      image: (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%', backgroundColor: '#fff3cd' }}>
          <p style={{ color: '#856404', fontSize: '30px', fontFamily: 'Poetsen One' }}>Loading... Please wait.</p>
        </div>
      ),
      intents: [<Button value="my_state">Try Again</Button>]
    });
  }
  const urlParams = new URLSearchParams(c.req.url.split('?')[1]);
  console.log('[Frame] URL Params:', urlParams.toString());
  const defaultInteractor = { fid: "N/A", username: "Unknown", pfpUrl: "" };
  const interactor = (c.var as any)?.interactor ?? defaultInteractor;
  const fid = urlParams.get("fid") || interactor.fid || "N/A";
  const username = urlParams.get("username") || interactor.username || "Unknown";
  const pfpUrl = urlParams.get("pfpUrl") || interactor.pfpUrl || "";
  console.log(`[Frame] FID: ${fid}, Username: ${username}, PFP: ${pfpUrl}`);
  console.log('[Frame] Fetching user data from cache');
  const { todayPeanutCount, totalPeanutCount, sentPeanutCount, remainingAllowance, userRank } = getUserDataFromCache(fid);
  console.log('[Frame] User data fetched');
  console.log('[Frame] Generating hashId');
  const hashId = await getOrGenerateHashId(fid);
  console.log('[Frame] Building frame URL');
  const frameUrl = `https://nuts-state.up.railway.app/?hashid=${hashId}&fid=${fid}&username=${encodeURIComponent(username)}&pfpUrl=${encodeURIComponent(pfpUrl)}`;
  console.log(`[Frame] Generated frameUrl: ${frameUrl}`);
  console.log('[Frame] Building compose URL');
  const composeCastUrl = `https://warpcast.com/~/compose?text=${encodeURIComponent(
    `Check out your 🥜 stats! \n\n Frame by @arsalang75523 & @jeyloo.eth `
  )}&embeds[]=${encodeURIComponent(frameUrl)}`;
  console.log(`[Frame] Generated composeCastUrl: ${composeCastUrl}`);
  try {
    console.log('[Frame] Rendering image');
    return c.res({
      image: (
        <div style={{
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
          width: '100%', height: '100%', backgroundImage: 'url(https://img12.pixhost.to/images/761/573945608_bg.png)',
          backgroundSize: '100% 100%', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
          textAlign: 'center', position: 'relative'
        }}>
          {pfpUrl && typeof pfpUrl === 'string' && pfpUrl.length > 0 && (
            <img src={pfpUrl} alt="Profile Picture" style={{
              width: '230px', height: '230px', borderRadius: '50%', position: 'absolute',
              top: '22%', left: '12%', transform: 'translate(-50%, -50%)', border: '3px solid white'
            }} />
          )}
          <p style={{ position: 'absolute', top: '15%', left: '60%', transform: 'translate(-50%, -50%)',
            color: 'white', fontSize: '52px', fontWeight: 'bold', fontFamily: 'Poetsen One',
            textShadow: '2px 2px 5px rgba(0, 0, 0, 0.7)' }}>{username || 'Unknown'}</p>
          <p style={{ position: 'absolute', top: '25%', left: '60%', transform: 'translate(-50%, -50%)',
            color: '#432818', fontSize: '30px', fontWeight: 'bold', fontFamily: 'Poetsen One' }}>
            FID: {fid || 'N/A'}
          </p>
          <p style={{ position: 'absolute', top: '47%', left: '32%', color: '#ff8c00', fontSize: '40px', fontFamily: 'Poetsen One' }}>{String(todayPeanutCount)}</p>
          <p style={{ position: 'absolute', top: '47%', left: '60%', color: '#ff8c00', fontSize: '40px', fontFamily: 'Poetsen One' }}>{String(totalPeanutCount)}</p>
          <p style={{ position: 'absolute', top: '77%', left: '32%', color: '#28a745', fontSize: '40px', fontFamily: 'Poetsen One' }}>{String(remainingAllowance)}</p>
          <p style={{ position: 'absolute', top: '77%', left: '60%', color: '#007bff', fontSize: '40px', fontFamily: 'Poetsen One' }}>{String(userRank)}</p>
        </div>
      ),
      intents: [
        <Button value="my_state">My State</Button>,
        <Button.Link href={composeCastUrl}>Share</Button.Link>,
        <Button.Link href="https://warpcast.com/basenuts">Join Us</Button.Link>,
      ],
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Frame] Render error:', errorMessage);
    return c.res({
      image: (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%', backgroundColor: '#ffcccc' }}>
          <p style={{ color: '#ff0000', fontSize: '30px', fontFamily: 'Poetsen One' }}>Error rendering frame. Please try again.</p>
        </div>
      ),
      intents: [<Button value="my_state">Try Again</Button>]
    });
  }
});

const port = process.env.PORT || 3000;
console.log(`[Server] Starting server on port ${port}`);
serve({
  fetch: app.fetch,
  port: Number(port)
});

// خط آخر برای چک کردن کامل بودن کد
console.log('[End] Code execution reached the end of the file');