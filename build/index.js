import { jsx as _jsx, jsxs as _jsxs } from "frog/jsx/jsx-runtime";
import { serveStatic } from "@hono/node-server/serve-static";
import { Button, Frog } from 'frog';
import { serve } from "@hono/node-server";
import { neynar } from 'frog/middlewares';
import fs from 'fs/promises';
const cacheFile = './cache.json';
let cache = {
    queries: {
        '4816299': { rows: [], lastUpdated: 0 },
        '4815993': { rows: [], lastUpdated: 0 },
        '4811780': { rows: [], lastUpdated: 0 },
        '4801919': { rows: [], lastUpdated: 0 }
    },
    initialFetchDone: false,
    updateCountToday: 0,
    lastUpdateDay: 0
};
const requestTimestamps = [];
const MAX_REQUESTS = 30;
const DURATION = 60000; // 60 ثانیه
function checkRateLimit() {
    const now = Date.now();
    while (requestTimestamps.length > 0 && now - requestTimestamps[0] > DURATION) {
        requestTimestamps.shift();
    }
    if (requestTimestamps.length >= MAX_REQUESTS) {
        console.log('[RateLimit] Too many requests. Remaining:', MAX_REQUESTS - requestTimestamps.length);
        return false;
    }
    requestTimestamps.push(now);
    console.log('[RateLimit] Allowed. Remaining:', MAX_REQUESTS - requestTimestamps.length);
    return true;
}
async function loadCache() {
    console.log('[Cache] Loading cache from file');
    try {
        const data = await fs.readFile(cacheFile, 'utf8');
        cache = JSON.parse(data);
        console.log(`[Cache] Loaded: initialFetchDone=${cache.initialFetchDone}, updateCountToday=${cache.updateCountToday}, lastUpdateDay=${new Date(cache.lastUpdateDay).toUTCString()}`);
    }
    catch (error) {
        console.log('[Cache] No cache file found. Starting fresh');
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
app.use(neynar({
    apiKey: 'NEYNAR_FROG_FM',
    features: []
}));
app.use('/*', serveStatic({ root: './public' }));
async function fetchQueryResult(queryId) {
    console.log(`[API] Fetching data for Query ${queryId}`);
    try {
        console.log(`[API] Sending request to https://api.dune.com/api/v1/query/${queryId}/results`);
        const response = await fetch(`https://api.dune.com/api/v1/query/${queryId}/results`, {
            method: 'GET',
            headers: { 'X-Dune-API-Key': 'RhjCYVQmxhjppZqg7Z8DUWwpyFpjPYf4' }
        });
        console.log('[API] Response received');
        const data = await response.json();
        const results = data?.result?.rows || [];
        console.log(`[API] Fetched ${results.length} rows for Query ${queryId}`);
        return results;
    }
    catch (error) {
        console.error(`[API] Error fetching Query ${queryId}:`, error);
        return [];
    }
}
function generateHashId(fid) {
    console.log(`[Hash] Generating hashId for FID ${fid}`);
    const timestamp = Date.now();
    const randomHash = Math.random().toString(36).substr(2, 9);
    const hashId = `${timestamp}-${fid}-${randomHash}`;
    console.log(`[Hash] Generated hashId: ${hashId}`);
    return hashId;
}
const hashIdCache = {};
async function getOrGenerateHashId(fid) {
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
function shouldUpdateApi(lastUpdated) {
    console.log('[UpdateCheck] Checking if API update is allowed');
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const totalMinutes = utcHours * 60 + utcMinutes;
    const currentDay = getCurrentUTCDay();
    const isNewDay = lastUpdated < currentDay;
    const updateTimes = [180, 540, 900, 1080, 1260];
    const isUpdateTime = updateTimes.some(time => Math.abs(totalMinutes - time) <= 5);
    console.log(`[UpdateCheck] Time: ${totalMinutes} min (${utcHours}:${utcMinutes} UTC), Last Updated: ${new Date(lastUpdated).toUTCString()}, New Day: ${isNewDay}, Update Time: ${isUpdateTime}`);
    return isUpdateTime && isNewDay;
}
async function updateCache() {
    console.log('[Cache] Entering updateCache');
    const now = Date.now();
    const lastUpdated = cache.queries['4816299'].lastUpdated;
    const currentDay = getCurrentUTCDay();
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
        const queryIds = ['4816299', '4815993', '4811780', '4801919'];
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
        console.log('[Cache] Not an update time or already updated. Skipping');
        return;
    }
    console.log(`[Cache] Scheduled update at ${new Date().toUTCString()}`);
    const queryIds = ['4816299', '4815993', '4811780', '4801919'];
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
function getUserDataFromCache(fid) {
    console.log(`[Data] Fetching data from cache for FID ${fid}`);
    const todayPeanutCountRow = cache.queries['4816299'].rows.find((row) => row.fid == fid || row.parent_fid == fid);
    console.log(`[Data] Today row found: ${todayPeanutCountRow ? 'yes' : 'no'}`);
    const totalPeanutCountRow = cache.queries['4815993'].rows.find((row) => row.fid == fid || row.parent_fid == fid);
    console.log(`[Data] Total row found: ${totalPeanutCountRow ? 'yes' : 'no'}`);
    const sentPeanutCountRow = cache.queries['4811780'].rows.find((row) => row.fid == fid || row.parent_fid == fid);
    console.log(`[Data] Sent row found: ${sentPeanutCountRow ? 'yes' : 'no'}`);
    const userRankRow = cache.queries['4801919'].rows.find((row) => row.fid == fid || row.parent_fid == fid);
    console.log(`[Data] Rank row found: ${userRankRow ? 'yes' : 'no'}`);
    const todayPeanutCount = todayPeanutCountRow?.peanut_count || 0;
    const totalPeanutCount = totalPeanutCountRow?.total_peanut_count || 0;
    const sentPeanutCount = sentPeanutCountRow?.sent_peanut_count || 0;
    const remainingAllowance = Math.max(30 - (sentPeanutCountRow?.sent_peanut_count || 0), 0);
    const userRank = userRankRow?.rank || 0;
    console.log(`[Data] FID ${fid} - Today: ${todayPeanutCount}, Total: ${totalPeanutCount}, Sent: ${sentPeanutCount}, Allowance: ${remainingAllowance}, Rank: ${userRank}`);
    return { todayPeanutCount, totalPeanutCount, sentPeanutCount, remainingAllowance, userRank };
}
app.frame('/', async (c) => {
    console.log(`[Frame] Request received at ${new Date().toUTCString()}`);
    console.log('[Frame] User-Agent:', c.req.header('user-agent'));
    if (!checkRateLimit()) {
        return c.res({
            image: (_jsx("div", { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%', backgroundColor: '#ffcccc' }, children: _jsx("p", { style: { color: '#ff0000', fontSize: '30px', fontFamily: 'Poetsen One' }, children: "Too many requests. Wait a minute." }) })),
            intents: [_jsx(Button, { value: "my_state", children: "Try Again" })]
        });
    }
    const urlParams = new URLSearchParams(c.req.url.split('?')[1]);
    console.log('[Frame] URL Params:', urlParams.toString());
    console.log('[Frame] c.var:', JSON.stringify(c.var, null, 2));
    const defaultInteractor = {
        fid: "N/A",
        username: "Unknown",
        pfpUrl: ""
    };
    const interactor = c.var?.interactor ?? defaultInteractor;
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
    console.log(`[Frame] Data - Today: ${todayPeanutCount}, Total: ${totalPeanutCount}, Sent: ${sentPeanutCount}, Allowance: ${remainingAllowance}, Rank: ${userRank}`);
    console.log('[Frame] Generating hashId');
    const hashId = await getOrGenerateHashId(fid);
    console.log('[Frame] Building frame URL');
    const frameUrl = `https://nuts-state.up.railway.app/?hashid=${hashId}&fid=${fid}&username=${encodeURIComponent(username)}&pfpUrl=${encodeURIComponent(pfpUrl)}`;
    console.log(`[Frame] Generated frameUrl: ${frameUrl}`);
    console.log('[Frame] Building compose URL');
    const composeCastUrl = `https://warpcast.com/~/compose?text=${encodeURIComponent(`Check out your 🥜 stats! \n\n Frame by @arsalang75523 & @jeyloo.eth `)}&embeds[]=${encodeURIComponent(frameUrl)}`;
    console.log(`[Frame] Generated composeCastUrl: ${composeCastUrl}`);
    try {
        console.log('[Frame] Preparing to render image with:', { fid, username, pfpUrl, todayPeanutCount, totalPeanutCount, sentPeanutCount, remainingAllowance, userRank });
        return c.res({
            image: (_jsxs("div", { style: {
                    display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                    width: '100%', height: '100%', backgroundImage: 'url(https://img12.pixhost.to/images/770/574027986_bg.png)',
                    backgroundSize: '100% 100%', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
                    textAlign: 'center', position: 'relative'
                }, children: [pfpUrl && typeof pfpUrl === 'string' && pfpUrl.length > 0 && (_jsx("img", { src: pfpUrl, alt: "Profile Picture", style: {
                            width: '230px', height: '230px', borderRadius: '50%', position: 'absolute',
                            top: '22%', left: '12%', transform: 'translate(-50%, -50%)', border: '3px solid white'
                        } })), _jsx("p", { style: { position: 'absolute', top: '15%', left: '60%', transform: 'translate(-50%, -50%)',
                            color: 'white', fontSize: '52px', fontWeight: 'bold', fontFamily: 'Poetsen One',
                            textShadow: '2px 2px 5px rgba(0, 0, 0, 0.7)' }, children: username || 'Unknown' }), _jsxs("p", { style: { position: 'absolute', top: '25%', left: '60%', transform: 'translate(-50%, -50%)',
                            color: '#432818', fontSize: '30px', fontWeight: 'bold', fontFamily: 'Poetsen One' }, children: ["FID: ", fid || 'N/A'] }), _jsx("p", { style: { position: 'absolute', top: '47%', left: '32%', color: '#ff8c00', fontSize: '40px', fontFamily: 'Poetsen One' }, children: String(todayPeanutCount || 0) }), _jsx("p", { style: { position: 'absolute', top: '47%', left: '60%', color: '#ff8c00', fontSize: '40px', fontFamily: 'Poetsen One' }, children: String(totalPeanutCount || 0) }), _jsx("p", { style: { position: 'absolute', top: '77%', left: '32%', color: '#28a745', fontSize: '40px', fontFamily: 'Poetsen One' }, children: String(remainingAllowance || 0) }), _jsx("p", { style: { position: 'absolute', top: '77%', left: '60%', color: '#007bff', fontSize: '40px', fontFamily: 'Poetsen One' }, children: String(userRank || 0) })] })),
            intents: [
                _jsx(Button, { value: "my_state", children: "My State" }),
                _jsx(Button.Link, { href: composeCastUrl, children: "Share" }),
                _jsx(Button.Link, { href: "https://warpcast.com/basenuts", children: "Join Us" }),
            ],
        });
    }
    catch (error) {
        console.error('[Frame] Render error:', error);
        console.error('[Frame] Failed with inputs:', { fid, username, pfpUrl, todayPeanutCount, totalPeanutCount, sentPeanutCount, remainingAllowance, userRank });
        return c.res({
            image: (_jsx("div", { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%', backgroundColor: '#ffcccc' }, children: _jsx("p", { style: { color: '#ff0000', fontSize: '30px' }, children: "Error rendering frame. Please try again later." }) })),
            intents: [_jsx(Button, { value: "my_state", children: "Try Again" })]
        });
    }
});
const port = process.env.PORT || 3000;
console.log(`[Server] Starting server on port ${port}`);
serve(app);
console.log(`[Server] Server running on port ${port}`);
