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
    '4810732': { rows: [], lastUpdated: 0 }, // دیلی
    '4815993': { rows: [], lastUpdated: 0 }, // توتال ناتس
    '4811780': { rows: [], lastUpdated: 0 }, // الوانس
    '4801919': { rows: [], lastUpdated: 0 }  // لیدربرد
  },
  initialFetchDone: false,
  updateCountToday: 0,
  lastUpdateDay: 0
};

const secondTimestamps: number[] = [];
const minuteTimestamps: number[] = [];
const MAX_RPS = 5;
const MAX_RPM = 300;
const SECOND_DURATION = 1000;
const MINUTE_DURATION = 60000;

function checkRateLimit(): boolean {
  const now = Date.now();
  while (secondTimestamps.length > 0 && now - secondTimestamps[0] > SECOND_DURATION) {
    secondTimestamps.shift();
  }
  if (secondTimestamps.length >= MAX_RPS) {
    console.log('[RateLimit] Too many requests per second. Remaining:', MAX_RPS - secondTimestamps.length);
    return false;
  }
  while (minuteTimestamps.length > 0 && now - minuteTimestamps[0] > MINUTE_DURATION) {
    minuteTimestamps.shift();
  }
  if (minuteTimestamps.length >= MAX_RPM) {
    console.log('[RateLimit] Too many requests per minute. Remaining:', MAX_RPM - minuteTimestamps.length);
    return false;
  }
  secondTimestamps.push(now);
  minuteTimestamps.push(now);
  console.log('[RateLimit] Allowed. RPS Remaining:', MAX_RPS - secondTimestamps.length, 'RPM Remaining:', MAX_RPM - minuteTimestamps.length);
  return true;
}

async function loadCache() {
  console.log('[Cache] Loading cache from file');
  try {
    const data = await fs.readFile(cacheFile, 'utf8');
    const loadedCache = JSON.parse(data);
    // فقط مقادیری که انتظار داریم رو بارگذاری می‌کنیم
    cache = {
      queries: {
        '4810732': loadedCache.queries['4810732'] || { rows: [], lastUpdated: 0 },
        '4815993': loadedCache.queries['4815993'] || { rows: [], lastUpdated: 0 },
        '4811780': loadedCache.queries['4811780'] || { rows: [], lastUpdated: 0 },
        '4801919': loadedCache.queries['4801919'] || { rows: [], lastUpdated: 0 }
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
}

console.log('[Server] Initializing cache');
loadCache().then(() => console.log('[Server] Cache initialized'));

export const app = new Frog({
  title: 'Nut State',
  imageOptions: {
    fonts: [{ name: 'Poetsen One', weight: 400, source: 'google' }],
  },
});

app.use(neynar({ apiKey: 'NEYNAR_FROG_FM', features: ['interactor', 'cast'] }));
app.use('/*', serveStatic({ root: './public' }));

async function fetchQueryResult(queryId: string) {
  console.log(`[API] Fetching data for Query ${queryId}`);
  try {
    console.log(`[API] Sending request to https://api.dune.com/api/v1/query/${queryId}/results`);
    const response = await fetch(`https://api.dune.com/api/v1/query/${queryId}/results`, {
      method: 'GET',
      headers: { 'X-Dune-API-Key': 'RhjCYVQmxhjppZqg7Z8DUWwpyFpjPYf4' }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    console.log('[API] Response received');
    const data = await response.json();
    const results = data?.result?.rows || [];
    console.log(`[API] Fetched ${results.length} rows for Query ${queryId}`);
    return results;
  } catch (error: unknown) {
    console.error(`[API] Error fetching Query ${queryId}:`, (error instanceof Error ? error.message : 'Unknown error'));
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
  const currentDay = getCurrentUTCDay();
  const isNewDay = lastUpdated < currentDay;

  const updateTimes = [180, 540, 605, 1090, 1260];
  const isUpdateTime = updateTimes.some(time => Math.abs(totalMinutes - time) <= 5);

  console.log(`[UpdateCheck] Time: ${totalMinutes} min (${utcHours}:${utcMinutes} UTC), Last Updated: ${new Date(lastUpdated).toUTCString()}, New Day: ${isNewDay}, Update Time: ${isUpdateTime}`);
  return isUpdateTime && isNewDay;
}

async function updateCache() {
  console.log('[Cache] Entering updateCache');
  const now = Date.now();
  const currentDay = getCurrentUTCDay();

  // چک کردن اینکه آیا کلیدها وجود دارن و مقداردهی پیش‌فرض اگه نباشن
  const queryIds = ['4810732', '4815993', '4811780', '4801919'];
  for (const queryId of queryIds) {
    if (!cache.queries[queryId]) {
      cache.queries[queryId] = { rows: [], lastUpdated: 0 };
    }
  }

  const lastUpdated = cache.queries['4810732'].lastUpdated; // از دیلی استفاده می‌کنیم

  console.log(`[Cache] Last updated: ${new Date(lastUpdated).toUTCString()}, Initial Fetch Done: ${cache.initialFetchDone}, Update Count: ${cache.updateCountToday}, Last Update Day: ${new Date(cache.lastUpdateDay).toUTCString()}`);

  if (cache.lastUpdateDay < currentDay) {
    console.log('[Cache] New day detected. Resetting update count');
    cache.updateCountToday = 0;
    cache.lastUpdateDay = currentDay;
  }

  if (cache.updateCountToday >= 6) {
    console.log('[Cache] Max 6 updates reached for today. Skipping');
    return;
  }

  if (!cache.initialFetchDone) {
    console.log(`[Cache] First request. Forcing update at ${new Date().toUTCString()}`);
    for (const queryId of queryIds) {
      const rows = await fetchQueryResult(queryId);
      cache.queries[queryId] = { rows, lastUpdated: now };
      console.log(`[Cache] Stored ${rows.length} rows for Query ${queryId}`);
    }
    cache.initialFetchDone = true;
    cache.updateCountToday += 1;
    cache.lastUpdateDay = currentDay;
    await saveCache();
    console.log('[Cache] Initial fetch completed');
    return;
  }

  if (!shouldUpdateApi(lastUpdated)) {
    console.log('[Cache] Not an update time or already updated. Using existing cache');
    return;
  }

  console.log(`[Cache] Scheduled update at ${new Date().toUTCString()}`);
  for (const queryId of queryIds) {
    const rows = await fetchQueryResult(queryId);
    cache.queries[queryId] = { rows, lastUpdated: now };
    console.log(`[Cache] Stored ${rows.length} rows for Query ${queryId}`);
  }
  cache.updateCountToday += 1;
  cache.lastUpdateDay = currentDay;
  await saveCache();
  console.log('[Cache] Scheduled update completed');
}

function getUserDataFromCache(fid: string) {
  console.log(`[Data] Fetching data from cache for FID ${fid}`);
  const todayPeanutCountRow = cache.queries['4810732'].rows.find((row: any) => row.fid == fid || row.parent_fid == fid) || {};
  const totalPeanutCountRow = cache.queries['4815993'].rows.find((row: any) => row.fid == fid || row.parent_fid == fid) || {};
  const sentPeanutCountRow = cache.queries['4811780'].rows.find((row: any) => row.fid == fid || row.parent_fid == fid) || {};
  const userRankRow = cache.queries['4801919'].rows.find((row: any) => row.fid == fid || row.parent_fid == fid) || {};

  const todayPeanutCount = todayPeanutCountRow.peanut_count || 0;
  const totalPeanutCount = totalPeanutCountRow.total_peanut_count || 0;
  const sentPeanutCount = sentPeanutCountRow.sent_peanut_count || 0;
  const remainingAllowance = Math.max(30 - (sentPeanutCountRow.sent_peanut_count || 0), 0);
  const userRank = userRankRow.rank || 0;

  console.log(`[Data] FID ${fid} - Today: ${todayPeanutCount}, Total: ${totalPeanutCount}, Sent: ${sentPeanutCount}, Allowance: ${remainingAllowance}, Rank: ${userRank}`);
  return { todayPeanutCount, totalPeanutCount, sentPeanutCount, remainingAllowance, userRank };
}

app.frame('/', async (c) => {
  console.log(`[Frame] Request received at ${new Date().toUTCString()}`);
  console.log('[Frame] User-Agent:', c.req.header('user-agent'));

  if (!checkRateLimit()) {
    return c.res({
      image: (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%', backgroundColor: '#ffcccc' }}>
          <p style={{ color: '#ff0000', fontSize: '30px', fontFamily: 'Poetsen One' }}>Too many requests. Wait a moment.</p>
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

  console.log('[Frame] Calling updateCache');
  await updateCache();
  console.log('[Frame] updateCache completed');

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
    console.error('[Frame] Render error:', (error instanceof Error ? error.message : 'Unknown error'));
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
serve(app);
console.log(`[Server] Server running on port ${port}`);