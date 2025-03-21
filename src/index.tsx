import { serveStatic } from "@hono/node-server/serve-static";
import { Button, Frog } from 'frog';
import { serve } from "@hono/node-server";
import { neynar } from 'frog/middlewares';
import fs from 'fs/promises';
import Moralis from 'moralis';
import { NeynarAPIClient, Configuration } from "@neynar/nodejs-sdk";

interface ApiRow {
  fid?: string;
  parent_fid?: string;
  sent_peanut_count?: number;
  daily_peanut_count?: number;
  all_time_peanut_count?: number;
  rank?: number;
  [key: string]: any;
}

const cacheFile = './cache.json';
let cache: {
  queries: Record<string, { rows: { fid: string; data: ApiRow; cumulativeExcess: number }[]; lastUpdated: number }>;
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


const NFT_CONTRACT_ADDRESS = '0x8AaB3b53d0F29A3EE07B24Ea253494D03a42e2fB';
const MORALIS_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6ImQ0NWYyNDBhLWFhOTctNDUwYi1iMWVlLTBjYTY0NzhjMzUwMiIsIm9yZ0lkIjoiNDM2OTgyIiwidXNlcklkIjoiNDQ5NTQzIiwidHlwZUlkIjoiY2ZlODFiYTQtY2I2Yy00NGIzLTgxOGMtYWQwNGM5NDhhNDFjIiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NDIzMjQ1NDEsImV4cCI6NDg5ODA4NDU0MX0.ZosOIvUNacwkQQbzrn4Nqr1Luw7K5XsJE-WAaGd0Ggw';

const config = new Configuration({
  apiKey: 'NEYNAR_FROG_FM', 
});
const client = new NeynarAPIClient(config);

console.log('[Moralis] Initializing Moralis SDK');
Moralis.start({ apiKey: MORALIS_API_KEY }).then(() => {
  console.log('[Moralis] Moralis SDK initialized successfully');
}).catch((error) => {
  console.error('[Moralis] Error initializing Moralis SDK:', error);
});

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
    cache.queries['4837362'].rows = cache.queries['4837362'].rows.map(row => ({
      fid: String(row.fid || (row.data && row.data.fid) || (row.data && row.data.parent_fid) || ''),
      data: row.data || row,
      cumulativeExcess: row.cumulativeExcess || 0
    }));
    console.log(`[Cache] Loaded from cache.json: rows=${cache.queries['4837362'].rows.length}`);
  } catch (error) {
    console.log('[Cache] No cache file found or invalid JSON. Starting fresh');
  }
}

async function saveCache() {
  console.log('[Cache] Saving cache to cache.json');
  await fs.writeFile(cacheFile, JSON.stringify(cache, null, 2));
  console.log(`[Cache] Cache saved to cache.json with ${cache.queries['4837362'].rows.length} rows`);
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
  console.log(`[API] Executing Query ${queryId} (Request #${++apiRequestCount}) - 1 credit consumed`);
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

async function fetchQueryResult(executionId: string, queryId: string): Promise<ApiRow[] | null> {
  console.log(`[API] Fetching results for Query ${queryId} with execution ID ${executionId} (Request #${++apiRequestCount}) - 1 credit consumed`);
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
    if (data.state === 'EXECUTING' || data.state === 'PENDING') {
      console.log(`[API] Query ${queryId} still executing or pending. Results not ready yet.`);
      return null;
    }
    const results: ApiRow[] = data?.result?.rows || [];
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

function getCurrentUTCDay(): number {
  console.log('[Time] Calculating current UTC day');
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
  console.log(`[Time] Current UTC day start: ${new Date(dayStart).toUTCString()}`);
  return dayStart;
}

function shouldUpdateApi(lastUpdated: number, isCacheEmpty: boolean): boolean {
  console.log('[UpdateCheck] Checking if API update is allowed');
  const now = new Date();
  const TWO_HOURS_IN_MS = 2 * 60 * 60 * 1000; // 2 ساعت در میلی‌ثانیه
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const totalMinutes = utcHours * 60 + utcMinutes;
  const updateTimes = [180, 353, 625, 1080, 1260]; // زمان‌های مشخص (دقیقه)

  if (isCacheEmpty) {
    console.log(`[UpdateCheck] Cache is empty. Allowing immediate update at ${utcHours}:${utcMinutes} UTC`);
    return true;
  }

  const closestUpdateTime = updateTimes.find(time => Math.abs(totalMinutes - time) <= 5);
  if (!closestUpdateTime) {
    console.log(`[UpdateCheck] Current time: ${utcHours}:${utcMinutes} UTC, Not in update window`);
    return false;
  }

  const timeSinceLastUpdate = now.getTime() - lastUpdated;
  if (timeSinceLastUpdate < TWO_HOURS_IN_MS) {
    console.log(`[UpdateCheck] In update window (${closestUpdateTime} minutes), but last update was ${(timeSinceLastUpdate / (1000 * 60)).toFixed(2)} minutes ago (< 2 hours). No update allowed`);
    return false;
  }

  console.log(`[UpdateCheck] In update window (${closestUpdateTime} minutes) and last update was ${(timeSinceLastUpdate / (1000 * 60)).toFixed(2)} minutes ago (> 2 hours). Allowing update`);
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
    console.log(`[Update] Last updated: ${new Date(lastUpdated).toUTCString()}, Initial Fetch Done: ${cache.initialFetchDone}, Update Count: ${cache.updateCountToday}, Cache Empty: ${isCacheEmpty}`);

    if (cache.lastUpdateDay < currentDay) {
      console.log('[Update] New day detected. Resetting update count');
      cache.updateCountToday = 0;
      cache.lastUpdateDay = currentDay;
    }

    if (cache.updateCountToday >= 6) {
      console.log('[Update] Max 6 updates reached for today. Skipping');
      return;
    }

    if (!shouldUpdateApi(lastUpdated, isCacheEmpty)) {
      console.log('[Update] Conditions for update not met. Skipping');
      return;
    }

    console.log(`[Update] Starting update at ${new Date().toUTCString()} - Only 2 requests allowed`);
    const executionId = await executeQuery(queryId);
    if (!executionId) {
      console.error('[Update] Failed to get execution ID. Aborting update');
      return;
    }

    console.log('[Update] Waiting 3 minutes for query execution to complete');
    await new Promise(resolve => setTimeout(resolve, 180000));

    const rows = await fetchQueryResult(executionId, queryId);
    if (rows === null) {
      console.warn('[Update] Results not ready after 3 minutes. Aborting');
      return;
    }
    if (rows.length === 0) {
      console.warn('[Update] No rows fetched from API despite expecting data');
    }

    const updatedRows = rows.map((row: ApiRow) => {
      const fid = String(row.fid || row.parent_fid || '');
      const sentPeanutCount = row.sent_peanut_count || 0;
      const excessToday = sentPeanutCount > 30 ? sentPeanutCount - 30 : 0;
      const existingRow = cache.queries[queryId].rows.find(r => r.fid === fid);
      const previousExcess = existingRow ? existingRow.cumulativeExcess : 0;
      return { fid, data: row, cumulativeExcess: previousExcess + excessToday };
    });

    cache.queries[queryId] = { rows: updatedRows, lastUpdated: now };
    if (!cache.initialFetchDone && isCacheEmpty) {
      cache.initialFetchDone = true;
      console.log('[Update] Initial fetch completed and locked');
    }
    cache.updateCountToday += 1;
    cache.lastUpdateDay = currentDay;
    await saveCache();
    console.log(`[Update] Update completed. Total requests: 2, Update count today: ${cache.updateCountToday}`);
  } finally {
    isUpdating = false;
  }
}

function scheduleUpdates() {
  setInterval(async () => {
    console.log('[Scheduler] Checking for scheduled update');
    await updateQueries();
  }, 5 * 60 * 1000);
}

console.log('[Server] Starting update scheduler');
scheduleUpdates();

async function getWalletAddressFromFid(fid: string): Promise<string | null> {
  console.log(`[Neynar] Fetching wallet address for FID ${fid}`);
  if (fid === 'N/A') {
    console.log('[Neynar] FID is N/A, skipping request');
    return null;
  }
  try {
    const response = await client.fetchBulkUsers({ fids: [Number(fid)] });
    const user = response.users[0];
    // اول verified_addresses رو چک می‌کنیم، اگه نبود custody_address
    const walletAddress = user?.verified_addresses?.eth_addresses?.[0] || user?.custody_address;
    console.log(`[Neynar] Wallet address for FID ${fid}: ${walletAddress}`);
    return walletAddress || null;
  } catch (error) {
    console.error(`[Neynar] Error fetching wallet address: ${error}`);
    return null;
  }
}

const manualFidList = new Set(["312316", "443855","486468","248836", "499556","425967", "417832", "442770", "349975", "921344", "426167", "435085", "482887", "231533", "429293", "1015315", "508756"]);

async function isNFTHolder(fid: string): Promise<boolean> {
  if (manualFidList.has(fid)) {
    console.log(`[NFT] FID ${fid} is manually set as a holder.`);
    return true;
  }

  console.log(`[NFT] Checking if FID ${fid} holds NFT from ${NFT_CONTRACT_ADDRESS}`);
  try {
    const walletAddress = await getWalletAddressFromFid(fid);
    if (!walletAddress) {
      console.log(`[NFT] No wallet address found for FID ${fid}`);
      return false;
    }

    const response = await Moralis.EvmApi.nft.getWalletNFTs({
      chain: '0x2105', // base 
      address: walletAddress,
      tokenAddresses: [NFT_CONTRACT_ADDRESS],
    });

    const hasNFT = response.result.length > 0;
    console.log(`[NFT] FID ${fid} has NFT: ${hasNFT}`);
    return hasNFT;
  } catch (error) {
    console.error(`[NFT] Error checking holder status: ${error}`);
    return false;
  }
}



async function getUserDataFromCache(fid: string): Promise<{ todayPeanutCount: number; totalPeanutCount: number; sentPeanutCount: number; remainingAllowance: number; userRank: number; reduceEndSeason: string | number }> {
  console.log(`[Data] Fetching data strictly from cache.json for FID ${fid}`);

  const userRow = cache.queries['4837362'].rows.find((row) => row.fid === fid) || { data: {}, cumulativeExcess: 0 };
  const userData: ApiRow = userRow.data;

  const hasFid = 'fid' in userRow && userRow.fid !== undefined;
  if (!hasFid) {
    console.warn(`[Data] No data found in cache.json for FID ${fid}. Returning default values`);
  } else {
    console.log(`[Data] Data found in cache.json for FID ${fid}`);
  }

  const todayPeanutCount = userData.daily_peanut_count || 0;
  const totalPeanutCount = userData.all_time_peanut_count || 0;
  const sentPeanutCount = userData.sent_peanut_count || 0;

  const isHolder = await isNFTHolder(fid);
  const maxAllowance = isHolder ? 150 : 30;
  const remainingAllowance = Math.max(maxAllowance - sentPeanutCount, 0);
  const userRank = userData.rank || 0;
  const reduceEndSeason = isHolder ? 'og' : (userRow.cumulativeExcess || 0);

  console.log(`[Data] FID ${fid} - Today: ${todayPeanutCount}, Total: ${totalPeanutCount}, Sent: ${sentPeanutCount}, Allowance: ${remainingAllowance}, Rank: ${userRank}, ReduceEndSeason: ${reduceEndSeason}`);
  return { todayPeanutCount, totalPeanutCount, sentPeanutCount, remainingAllowance, userRank, reduceEndSeason };
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

  const fid = String(urlParams.get("fid") || interactor.fid || "N/A");
  const username = urlParams.get("username") || interactor.username || "Unknown";
  const pfpUrl = urlParams.get("pfpUrl") || interactor.pfpUrl || "";
  console.log(`[Frame] FID: ${fid}, Username: ${username}, PFP: ${pfpUrl}`);

  console.log('[Frame] Fetching user data exclusively from cache.json');
  const { todayPeanutCount, totalPeanutCount, sentPeanutCount, remainingAllowance, userRank, reduceEndSeason } = await getUserDataFromCache(fid);
  console.log('[Frame] User data fetched exclusively from cache.json');

  console.log('[Frame] Generating hashId');
  const hashId = await getOrGenerateHashId(fid);
  console.log('[Frame] Building frame URL');
  const frameUrl = `https://nuts-state.up.railway.app/?hashid=${hashId}&fid=${fid}&username=${encodeURIComponent(username)}&pfpUrl=${encodeURIComponent(pfpUrl)}`;
  console.log(`[Frame] Generated frameUrl: ${frameUrl}`);
  console.log('[Frame] Building compose URL');
  const composeCastUrl = `https://warpcast.com/~/compose?text=${encodeURIComponent(
    `Check out your 🥜 stats! \n\n Frame by @arsalang.eth & @jeyloo.eth `
  )}&embeds[]=${encodeURIComponent(frameUrl)}`;
  console.log(`[Frame] Generated composeCastUrl: ${composeCastUrl}`);

  try {
    console.log('[Frame] Rendering image using data only from cache.json');
    return c.res({
      image: (
        <div style={{
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
          width: '100%', height: '100%', backgroundImage: 'url(https://img12.pixhost.to/images/1015/577507406_bg.png)',
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
          <p style={{ position: 'absolute', top: '47%', left: '24%', color: '#ff8c00', fontSize: '40px', fontFamily: 'Poetsen One' }}>{String(todayPeanutCount)}</p>
          <p style={{ position: 'absolute', top: '47%', left: '52%', color: '#ff8c00', fontSize: '40px', fontFamily: 'Poetsen One' }}>{String(totalPeanutCount)}</p>
          <p style={{ position: 'absolute', top: '76%', left: '24%', color: '#28a745', fontSize: '40px', fontFamily: 'Poetsen One' }}>{String(remainingAllowance)}</p>
          <p style={{ position: 'absolute', top: '76%', left: '52%', color: '#007bff', fontSize: '40px', fontFamily: 'Poetsen One' }}>{String(userRank)}</p>
          <p style={{ 
    position: 'absolute', 
    top: '62%', 
    left: '87%', 
    color: '#ff0000', 
    fontSize: '43px', 
    fontFamily: 'Poetsen One' 
}}>
    {reduceEndSeason !== 0 ? String(reduceEndSeason) : ''}
</p>
<p style={{ position: 'absolute', top: '45%', left: '81%', color: '#efb976', fontSize: '29px', fontFamily: 'Poetsen One' }}>
  {reduceEndSeason !== "og" ? (
    <>
<div style={{ display: "flex", flexDirection: "column" }}>
  <p style={{ lineHeight: "1", margin: "0" }}>Reduced at</p>
  <p style={{ lineHeight: "1", margin: "0" }}>Season End</p>
</div>



    </>
  ) : (
    <span style={{ top: "60%",  color: "#efb976", fontSize: "25px", fontFamily: "Poetsen One" }}>
    Member Type
  </span>
  
  )}
</p>
{reduceEndSeason === 0 && (
    <img 
        src="https://img12.pixhost.to/images/870/575350880_tik.png" 
        alt="No data" 
        width="80" 
        height="80" 
        style={{
            position: 'absolute',  
            top: '63%',            
            left: '85%',          
        }}
    />
)}
{reduceEndSeason === "og" && (
    <img 
        src="https://img12.pixhost.to/images/1016/577511680_og.png" 
        alt="OG Badge" 
        width="125" 
        height="125" 
        style={{
          position: 'absolute',  
          top: '59%',            
          left: '83%',                 
        }}
    />
)}

        </div>
      ),
      intents: [
        <Button value="my_state">My State</Button>,
        <Button.Link href={composeCastUrl}>Share</Button.Link>,
        <Button.Link href="https://warpcast.com/basenuts">Join Us</Button.Link>,
        <Button.Link href="https://foundation.app/mint/base/0x8AaB3b53d0F29A3EE07B24Ea253494D03a42e2fB">Be OG</Button.Link>,
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
serve(app);