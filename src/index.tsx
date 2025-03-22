import { serveStatic } from "@hono/node-server/serve-static";
import { Button, Frog, TextInput } from 'frog';
import { serve } from "@hono/node-server";
import { neynar } from 'frog/middlewares';
import fs from 'fs/promises';
import Moralis from 'moralis';
import { NeynarAPIClient, Configuration } from "@neynar/nodejs-sdk";

// تایپ‌ها
interface ApiRow {
  fid?: string;
  parent_fid?: string;
  sent_peanut_count?: number;
  daily_peanut_count?: number;
  all_time_peanut_count?: number;
  rank?: number;
  [key: string]: any;
}

interface NFTHolder {
  wallet: string;
  count: number;
}

// ثابت‌ها
const cacheFile = './cache.json';
const ogHoldersFile = './nft_holders.json';
const newHoldersFile = './new_nft_holders.json';
let cache: {
  queries: Record<string, { rows: { fid: string; data: ApiRow; cumulativeExcess: number }[]; lastUpdated: number }>;
  initialFetchDone: boolean;
  updateCountToday: number;
  lastUpdateDay: number;
} = {
  queries: { '4837362': { rows: [], lastUpdated: 0 } },
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
let OGpic: number = 0;
let Usertype = "";
const OG_NFT_CONTRACT_ADDRESS = '0x8AaB3b53d0F29A3EE07B24Ea253494D03a42e2fB';
const NEW_NFT_CONTRACT_ADDRESS = '0x36d4a78d0FB81A16A1349b8f95AF7d5d3CA25081';
const MORALIS_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6ImE1MjE5NDlkLTU2MWItNDE5NC1hMmI5LTQxZTgxMDA4M2E3NyIsIm9yZ0lkIjoiNDM3MDA0IiwidXNlcklkIjoiNDQ5NTY1IiwidHlwZUlkIjoiNmJmNzAzZGItNmM1Ni00NGViLTg4ZmMtNjJjOWMzMTk4Zjc2IiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NDIzMzMzNTksImV4cCI6NDg5ODA5MzM1OX0.Lv8JHB8RrbC7UWLJXHijd3kUsaaqmfUt14QCcW71JU0';

// دکمه TRUE/FALSE برای هولدرهای بدون NFT
const ALLOW_NON_HOLDERS = true;

// تنظیمات Neynar با API Key جدید
const config = new Configuration({ apiKey: '0AFD6D12-474C-4AF0-B580-312341F61E17' });
const client = new NeynarAPIClient(config);

// راه‌اندازی Moralis
console.log('[Moralis] Initializing Moralis SDK');
Moralis.start({ apiKey: MORALIS_API_KEY }).then(() => {
  console.log('[Moralis] Moralis SDK initialized successfully');
}).catch((error) => {
  console.error('[Moralis] Error initializing Moralis SDK:', error);
});

// توابع
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
    const loadedCache = JSON.parse(data) as typeof cache;
    cache = {
      queries: { '4837362': loadedCache.queries['4837362'] || { rows: [], lastUpdated: 0 } },
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
    imageAspectRatio : '1:1',
    title: 'Nuts State',
  
  imageOptions: { fonts: [{ name: 'Poetsen One', weight: 400, source: 'google' }] },
});

app.use(neynar({ apiKey: '0AFD6D12-474C-4AF0-B580-312341F61E17', features: ['interactor', 'cast'] }));
app.use('/*', serveStatic({ root: './public' }));

async function executeQuery(queryId: string): Promise<string | null> {
  console.log(`[API] Executing Query ${queryId} (Request #${++apiRequestCount}) - 1 credit consumed`);
  try {
    const response = await fetch(`https://api.dune.com/api/v1/query/${queryId}/execute`, {
      method: 'POST',
      headers: { 'X-Dune-API-Key': 'croXzXynGL2zPt5h4w1esQXARtxge6Q5' }
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    const data = await response.json() as { execution_id: string };
    console.log(`[API] Query ${queryId} execution started with ID: ${data.execution_id}`);
    return data.execution_id;
  } catch (error) {
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
      headers: { 'X-Dune-API-Key': 'croXzXynGL2zPt5h4w1esQXARtxge6Q5' }
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    const data = await response.json() as { state: string; result?: { rows: ApiRow[] } };
    if (data.state === 'EXECUTING' || data.state === 'PENDING') {
      console.log(`[API] Query ${queryId} still executing or pending. Results not ready yet.`);
      return null;
    }
    const results: ApiRow[] = data?.result?.rows || [];
    console.log(`[API] Fetched ${results.length} rows for Query ${queryId}`);
    return results;
  } catch (error) {
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
  const TWO_HOURS_IN_MS = 2 * 60 * 60 * 1000;
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const totalMinutes = utcHours * 60 + utcMinutes;
  const updateTimes = [180, 353, 625, 1080, 1260];

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

    const updatedRows = rows.map(async (row: ApiRow) => {
      const fid = String(row.fid || row.parent_fid || '');
      const sentPeanutCount = row.sent_peanut_count || 0;

      const ogNFTCount = await isOGNFTHolder(fid);
      const newNFTCount = await isNewNFTHolder(fid);
      const ogAllowance = ogNFTCount * 150;
      const newAllowance = newNFTCount === 1 ? 30 : newNFTCount === 2 ? 45 : newNFTCount >= 3 ? 60 : 0;
      const nonHolderAllowance = (ogNFTCount === 0 && newNFTCount === 0 && ALLOW_NON_HOLDERS) ? 30 : 0;
      const maxAllowance = ogAllowance + newAllowance + nonHolderAllowance;

      const excess = sentPeanutCount > maxAllowance ? sentPeanutCount - maxAllowance : 0;
      const existingRow = cache.queries[queryId].rows.find(r => r.fid === fid);
      const cumulativeExcess = (existingRow ? existingRow.cumulativeExcess : 0) + excess;

      return { fid, data: row, cumulativeExcess };
    });

    cache.queries[queryId] = { rows: await Promise.all(updatedRows), lastUpdated: now };
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
    const walletAddress = user?.verified_addresses?.eth_addresses?.[0] || user?.custody_address;
    console.log(`[Neynar] Wallet address for FID ${fid}: ${walletAddress}`);
    return walletAddress || null;
  } catch (error) {
    console.error(`[Neynar] Error fetching wallet address: ${error}`);
    return null;
  }
}

async function isOGNFTHolder(fid: string): Promise<number> {
  console.log(`[NFT] Checking if FID ${fid} holds OG NFT from ${OG_NFT_CONTRACT_ADDRESS} using offline data`);
  try {
    const walletAddress = await getWalletAddressFromFid(fid);
    if (!walletAddress) {
      console.log(`[NFT] No wallet address found for FID ${fid}`);
      return 0;
    }
    const holdersData = await fs.readFile(ogHoldersFile, 'utf8');
    const { holders }: { holders: NFTHolder[] } = JSON.parse(holdersData);
    const holder = holders.find(h => h.wallet.toLowerCase() === walletAddress.toLowerCase());
    const count = holder ? holder.count : 0;
    console.log(`[NFT] FID ${fid} (Wallet: ${walletAddress}) holds ${count} OG NFTs`);
    return count;
  } catch (error) {
    console.error(`[NFT] Error checking OG holder status offline: ${error}`);
    return 0;
  }
}

async function isNewNFTHolder(fid: string): Promise<number> {
  console.log(`[NFT] Checking if FID ${fid} holds New NFT from ${NEW_NFT_CONTRACT_ADDRESS} using offline data`);
  try {
    const walletAddress = await getWalletAddressFromFid(fid);
    if (!walletAddress) {
      console.log(`[NFT] No wallet address found for FID ${fid}`);
      return 0;
    }
    const holdersData = await fs.readFile(newHoldersFile, 'utf8');
    const { holders }: { holders: NFTHolder[] } = JSON.parse(holdersData);
    const holder = holders.find(h => h.wallet.toLowerCase() === walletAddress.toLowerCase());
    const count = holder ? holder.count : 0;
    console.log(`[NFT] FID ${fid} (Wallet: ${walletAddress}) holds ${count} New NFTs`);
    return count;
  } catch (error) {
    console.error(`[NFT] Error checking New NFT holder status offline: ${error}`);
    return 0;
  }
}

async function getUserDataFromCache(fid: string): Promise<{
  todayPeanutCount: number;
  totalPeanutCount: number;
  sentPeanutCount: number;
  remainingAllowance: string;
  userRank: number;
  reduceEndSeason: string;
  usingWallet: string;
}> {
  console.log(`[Data] Fetching data strictly from cache.json for FID ${fid}`);
  const userRow = cache.queries['4837362'].rows.find((row) => row.fid === fid) || { data: {}, cumulativeExcess: 0 };
  const userData: ApiRow = userRow.data;

  const todayPeanutCount = userData.daily_peanut_count || 0;
  const totalPeanutCount = userData.all_time_peanut_count || 0;
  const sentPeanutCount = userData.sent_peanut_count || 0;

  const ogNFTCount = await isOGNFTHolder(fid);
  const newNFTCount = await isNewNFTHolder(fid);

  // تنظیم متغیرهای OGpic و Usertype برای استفاده در رندر بج‌ها
  OGpic = ogNFTCount; // تعداد OG NFTها
  if (newNFTCount === 1) {
    Usertype = "Member";
  } else if (newNFTCount === 2) {
    Usertype = "Regular";
  } else if (newNFTCount >= 3) {
    Usertype = "Active";
  } else {
    Usertype = "Noobie";
  }

  let maxAllowance: number;
  let remainingAllowance: string;
  let reduceEndSeason = '';

  // محاسبه الوانس کل با جمع OG و NEW
  const ogAllowance = ogNFTCount * 150;
  const newAllowance = newNFTCount === 1 ? 30 : newNFTCount === 2 ? 45 : newNFTCount >= 3 ? 60 : 0;
  const nonHolderAllowance = (ogNFTCount === 0 && newNFTCount === 0 && ALLOW_NON_HOLDERS) ? 30 : 0;
  maxAllowance = ogAllowance + newAllowance + nonHolderAllowance;

  if (ogNFTCount > 0 || newNFTCount > 0) {
    remainingAllowance = `${maxAllowance} / ${Math.max(maxAllowance - sentPeanutCount, 0)}`;
    reduceEndSeason = sentPeanutCount > maxAllowance ? String(sentPeanutCount - maxAllowance) : '';
  } else {
    if (ALLOW_NON_HOLDERS) {
      remainingAllowance = `${maxAllowance} / ${Math.max(maxAllowance - sentPeanutCount, 0)}`;
      reduceEndSeason = sentPeanutCount > maxAllowance ? String(sentPeanutCount - maxAllowance) : '';
    } else {
      maxAllowance = 0;
      remainingAllowance = 'mint your allowance';
      reduceEndSeason = sentPeanutCount > maxAllowance ? String(sentPeanutCount - maxAllowance) : '';
    }
  }

  const existingRowIndex = cache.queries['4837362'].rows.findIndex(row => row.fid === fid);
  if (existingRowIndex !== -1 && (ogNFTCount > 0 || newNFTCount > 0)) {
    cache.queries['4837362'].rows[existingRowIndex].cumulativeExcess = userRow.cumulativeExcess + (sentPeanutCount > maxAllowance ? sentPeanutCount - maxAllowance : 0);
  } else if (existingRowIndex === -1 && (ogNFTCount > 0 || newNFTCount > 0)) {
    cache.queries['4837362'].rows.push({ fid, data: userData, cumulativeExcess: sentPeanutCount > maxAllowance ? sentPeanutCount - maxAllowance : 0 });
  }

  const userRank = userData.rank || 0;
  const walletAddress = await getWalletAddressFromFid(fid);
  const usingWallet = walletAddress ? `${walletAddress.slice(0, 3)}...${walletAddress.slice(-3)}` : 'N/A';

  console.log(`[Data] FID ${fid} - Today: ${todayPeanutCount}, Total: ${totalPeanutCount}, Sent: ${sentPeanutCount}, Allowance: ${remainingAllowance}, Rank: ${userRank}, ReduceEndSeason: ${reduceEndSeason}, UsingWallet: ${usingWallet}`);
  return { todayPeanutCount, totalPeanutCount, sentPeanutCount, remainingAllowance, userRank, reduceEndSeason, usingWallet };
}

app.frame('/', async (c) => {
  console.log(`[Frame] Request received at ${new Date().toUTCString()}`);
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
  const defaultInteractor = { fid: "N/A", username: "Unknown", pfpUrl: "" };
  const interactor = (c.var as any)?.interactor ?? defaultInteractor;

  const fid = String(urlParams.get("fid") || interactor.fid || "N/A");
  const username = urlParams.get("username") || interactor.username || "Unknown";
  const pfpUrl = urlParams.get("pfpUrl") || interactor.pfpUrl || "";

  const { todayPeanutCount, totalPeanutCount, sentPeanutCount, remainingAllowance, userRank, reduceEndSeason, usingWallet } = await getUserDataFromCache(fid);
  const hashId = await getOrGenerateHashId(fid);
  const frameUrl = `https://nuts-state.up.railway.app/?hashid=${hashId}&fid=${fid}&username=${encodeURIComponent(username)}&pfpUrl=${encodeURIComponent(pfpUrl)}`;
  const composeCastUrl = `https://warpcast.com/~/compose?text=${encodeURIComponent('Check out your 🥜 stats! \n\n Frame by @arsalang.eth & @jeyloo.eth ')}&embeds[]=${encodeURIComponent(frameUrl)}`;

  try {
    console.log("usertype:", Usertype);
    
    return c.res({
      image: (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            width: "100%", 
            height: "100%", 
            backgroundColor: "black",
            color: "white",
            fontFamily: "'Lilita One','Poppins'",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* BG */}
          <img
            src="https://img12.pixhost.to/images/1086/578480364_bg.png"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              position: "absolute",
              top: 0,
              left: 0,
            }}
          />
    
          {/* Pfp Url */}
          {pfpUrl && (
            <img
              src={pfpUrl}
              alt="Profile Picture"
              style={{
                width: "160px",
                height: "160px",
                borderRadius: "50%",
                position: "absolute",
                top: "3.5%",
                left: "25.5%",
                border: "3px solid white",
              }}
            />
          )}
    
          {/* Username */}
          <p
            style={{
              position: "absolute",
              top: "8%",
              left: "57%",
              transform: "translateX(-50%)",
              color: "cyan",
              fontSize: "30px",
              fontWeight: "700",
            }}
          >
            {username}
          </p>
    
          {/* FID */}
          <p
            style={{
              position: "absolute",
              top: "14%",
              left: "57%",
              transform: "translateX(-50%)",
              color: "white",
              fontSize: "15px",
              fontWeight: "500",
            }}
          >
            {fid}
          </p>
    
          <p
            style={{
              position: "absolute",
              top: "46%",
              left: "58%",
              color: "#ff8c00",
              fontSize: "33px",
            }}
          >
            {totalPeanutCount}
          </p>
    
          <p
            style={{
              position: "absolute",
              top: "64%",
              left: "36%",
              color: "#28a745",
              fontSize: "33px",
            }}
          >
            {remainingAllowance}
          </p>
          <p
            style={{
              position: "absolute",
              top: "46%",
              left: "40%",
              color: "#ff8c00",
              fontSize: "33px",
            }}
          >
            {todayPeanutCount}
          </p>
          <p
            style={{
              position: "absolute",
              top: "81%",
              left: "59%",
              color: "#ffffff",
              fontSize: "33px",
            }}
          >
            {usingWallet}
          </p>
          <p
            style={{
              position: "absolute",
              top: "64%",
              left: "58%",
              color: "#007bff",
              fontSize: "33px",
            }}
          >
            {userRank}
          </p>

          {/* نمایش بج‌ها بر اساس شرایط جدید */}
          {/* بج OG: اگر هولدر حداقل 1 NFT نوع OG داشته باشه */}
          {OGpic > 0 && (
            <img
              src="https://img12.pixhost.to/images/1090/578542519_og-6-copy.png"
              width="131"
              height="187"
              style={{
                position: "absolute",
                top: "7.8%",
                left: "37.5%",
              }}
            />
          )}

          {/* بج Member: اگر هولدر حداقل 1 NFT نوع New داشته باشه */}
          {(Usertype === "Member" || Usertype === "Regular" || Usertype === "Active") && (
            <img
              src="https://img12.pixhost.to/images/1092/578585661_2.png"
              width="100"
              height="100"
              style={{
                position: "absolute",
                top: "25%",
                left: "66%",
              }}
            />
          )}

          {/* بج Regular: اگر هولدر حداقل 2 NFT نوع New داشته باشه */}
          {(Usertype === "Regular" || Usertype === "Active") && (
            <img
              src="https://img12.pixhost.to/images/1093/578590423_1.png"
              width="100"
              height="100"
              style={{
                position: "absolute",
                top: "25%",
                left: "57.5%",
              }}
            />
          )}

          {/* بج Active: اگر هولدر 3 یا بیشتر NFT نوع New داشته باشه */}
          {Usertype === "Active" && (
            <img
              src="https://img12.pixhost.to/images/1092/578587015_3.png"
              width="100"
              height="100"
              style={{
                position: "absolute",
                top: "25%",
                left: "49%",
              }}
            />
          )}

          {/* نمایش تیک در صورت عدم وجود Reduce End Season */}
          {reduceEndSeason === "" && (
            <img
              src="https://img12.pixhost.to/images/870/575350880_tik.png"
              width="55"
              height="55"
              style={{
                position: "absolute",
                top: "83%",
                left: "35%",
              }}
            />
          )}

          {/* Reduce */}
          <p
            style={{
              position: "absolute",
              top: "81%",
              left: "35%",
              color: "#ff0000",
              fontSize: "35px",
            }}
          >
            {reduceEndSeason}
          </p>
        </div>
      ),
        
      intents: [
        <Button value="my_state">My State</Button>,
        <Button.Link href={composeCastUrl}>Share</Button.Link>,
        <Button.Link href="https://foundation.app/mint/base/0x8AaB3b53d0F29A3EE07B24Ea253494D03a42e2fB">Be OG</Button.Link>,
        <Button.Link href="https://foundation.app/mint/base/0x36d4a78d0FB81A16A1349b8f95AF7d5d3CA25081">Allowance</Button.Link>,
      ],
    });
  } catch (error) {
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

const port: number = Number(process.env.PORT) || 3000;
console.log(`[Server] Starting server on port ${port}`);
serve(app);