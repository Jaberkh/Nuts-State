import { serveStatic } from "@hono/node-server/serve-static";
import { Button, Frog } from 'frog';
import { serve } from "@hono/node-server";
import { neynar } from 'frog/middlewares';

const cache: Record<string, {
  todayPeanutCount: number;
  totalPeanutCount: number;
  sentPeanutCount: number;
  remainingAllowance: number;
  userRank: number;
  lastUpdated: number;
}> = {};

export const app = new Frog({
  title: 'Nut State',
  imageOptions: {
    fonts: [
      {
        name: 'Poetsen One',
        weight: 400,
        source: 'google',
      },
    ],
  },
}).use(
  neynar({
    apiKey: 'NEYNAR_FROG_FM',
    features: ['interactor', 'cast'],
  })
);

app.use('/*', serveStatic({ root: './public' }));

async function fetchQueryResult(fid: any, queryId: string, columnName: string) {
  try {
    const response = await fetch(`https://api.dune.com/api/v1/query/${queryId}/results`, {
      method: 'GET',
      headers: {
        'X-Dune-API-Key': 'RhjCYVQmxhjppZqg7Z8DUWwpyFpjPYf4'
      }
    });
    
    const data = await response.json();
    const results = data?.result?.rows || [];
    const userResult = results.find((row: { fid: any; parent_fid: any }) => row.fid == fid || row.parent_fid == fid)?.[columnName] || 0;
    return userResult;
  } catch (error) {
    console.error(`Error fetching data from Query ${queryId}:`, error);
    return 0;
  }
}

function generateHashId(fid: string): string {
  const timestamp = Date.now();
  const randomHash = Math.random().toString(36).substr(2, 9);
  return `${timestamp}-${fid}-${randomHash}`;
}

const hashIdCache: Record<string, string> = {}; 

async function getOrGenerateHashId(fid: string): Promise<string> {
  if (hashIdCache[fid]) {
    return hashIdCache[fid];
  }
  const newHashId = generateHashId(fid);
  hashIdCache[fid] = newHashId;
  return newHashId;
}

function shouldUpdateApi() {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const totalMinutes = utcHours * 60 + utcMinutes;

  const updateTimes = [360, 900, 1260];
  
  return updateTimes.some(time => Math.abs(totalMinutes - time) <= 5);
}

async function getUserData(fid: string) {
  const now = Date.now();
  const cachedData = cache[fid];

  if (cachedData && (now - cachedData.lastUpdated) < 24 * 60 * 60 * 1000) {
    return cachedData;
  }

  // if (shouldUpdateApi()) {
    const todayPeanutCount = await fetchQueryResult(fid, '4816299', 'peanut_count');
    const totalPeanutCount = await fetchQueryResult(fid, '4815993', 'total_peanut_count');
    const sentPeanutCount = await fetchQueryResult(fid, '4811780', 'sent_peanut_count');
    const remainingAllowance = Math.max(30 - sentPeanutCount, 0);
    const userRank = await fetchQueryResult(fid, '4801919', 'rank');

    cache[fid] = {
      todayPeanutCount,
      totalPeanutCount,
      sentPeanutCount,
      remainingAllowance,
      userRank,
      lastUpdated: now
    };
  // }

  return cachedData || {
    todayPeanutCount: 0,
    totalPeanutCount: 0,
    sentPeanutCount: 0,
    remainingAllowance: 30,
    userRank: 0,
    lastUpdated: now
  };
}

app.frame('/', async (c) => {
  const urlParams = new URLSearchParams(c.req.url.split('?')[1]);

  // اگر فریم از طریق Embed لود شده باشه، اطلاعات رو از URL بگیر
  const fid = urlParams.get("fid") || (c.var as any)?.interactor?.fid || "N/A";
  const username = urlParams.get("username") || (c.var as any)?.interactor?.username || "Unknown";
  const pfpUrl = urlParams.get("pfpUrl") || (c.var as any)?.interactor?.pfpUrl || "";

  // دریافت داده‌ها (از کش یا API)
  const userData = await getUserData(fid);
  const { todayPeanutCount, totalPeanutCount, sentPeanutCount, remainingAllowance, userRank } = userData;

  const hashId = await getOrGenerateHashId(fid);
  const frameUrl = `https://nuts-state.up.railway.app/?hashid=${hashId}&fid=${fid}&username=${encodeURIComponent(username)}&pfpUrl=${encodeURIComponent(pfpUrl)}`;

  const composeCastUrl = `https://warpcast.com/~/compose?text=${encodeURIComponent(
    `Check out your 🥜 stats! \n\n Frame by @arsalang75523 & @jeyloo.eth `
  )}&embeds[]=${encodeURIComponent(frameUrl)}`;
  
  return c.res({
    image: (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          width: '100%',
          height: '100%',
          backgroundImage: 'url(https://img12.pixhost.to/images/724/573425032_bg.png)',
          backgroundSize: '100% 100%',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          textAlign: 'center',
          position: 'relative',
        }}
      >
        {pfpUrl && (
          <img
            src={pfpUrl}
            alt="Profile Picture"
            style={{
              width: '230px',
              height: '230px',
              borderRadius: '50%',
              position: 'absolute',
              top: '22%',
              left: '12%',
              transform: 'translate(-50%, -50%)',
              border: '3px solid white',
            }}
          />
        )}

        <p
          style={{
            position: 'absolute',
            top: '15%',
            left: '60%',
            transform: 'translate(-50%, -50%)',
            color: 'white',
            fontSize: '52px',
            fontWeight: 'bold',
            fontFamily: 'Poetsen One',
            textShadow: '2px 2px 5px rgba(0, 0, 0, 0.7)',
          }}
        >
          {username}
        </p>

        <p
          style={{
            position: 'absolute',
            top: '25%',
            left: '60%',
            transform: 'translate(-50%, -50%)',
            color: '#432818',
            fontSize: '30px',
            fontWeight: 'bold',
            fontFamily: 'Poetsen One',
          }}
        >
          FID: {fid}
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
});

const port = process.env.PORT || 3000;

// اطمینان از استفاده صحیح از عدد به عنوان پورت
serve(app);
console.log(`Server is running on port ${port}`);