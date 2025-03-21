import Moralis from 'moralis';
import fs from 'fs/promises';

const NFT_CONTRACT_ADDRESS = '0x36d4a78d0FB81A16A1349b8f95AF7d5d3CA25081';
const MORALIS_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6ImE1MjE5NDlkLTU2MWItNDE5NC1hMmI5LTQxZTgxMDA4M2E3NyIsIm9yZ0lkIjoiNDM3MDA0IiwidXNlcklkIjoiNDQ5NTY1IiwidHlwZUlkIjoiNmJmNzAzZGItNmM1Ni00NGViLTg4ZmMtNjJjOWMzMTk4Zjc2IiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NDIzMzMzNTksImV4cCI6NDg5ODA5MzM1OX0.Lv8JHB8RrbC7UWLJXHijd3kUsaaqmfUt14QCcW71JU0';
const OUTPUT_FILE = './new_nft_holders.json';

async function fetchNewNFTHolders() {
  console.log('[FetchNewHolders] Initializing Moralis SDK');
  await Moralis.start({ apiKey: MORALIS_API_KEY });

  let holderCounts = {};
  let cursor = null;

  try {
    do {
      console.log('[FetchNewHolders] Fetching NFT holders, cursor:', cursor || 'initial');
      const response = await Moralis.EvmApi.nft.getContractNFTs({
        chain: '0x2105',
        address: NFT_CONTRACT_ADDRESS,
        limit: 100,
        cursor: cursor,
      });

      const nfts = response.result;
      console.log(`[FetchNewHolders] Fetched ${nfts.length} NFTs in this batch`);

      for (const nft of nfts) {
        const owner = nft.ownerOf;
        if (owner && typeof owner._value === 'string') {
          const wallet = owner._value.toLowerCase();
          holderCounts[wallet] = (holderCounts[wallet] || 0) + 1;
        } else {
          console.warn(`[FetchNewHolders] Invalid ownerOf for NFT ${nft.tokenId}:`, owner);
        }
      }

      cursor = response.pagination.cursor;
    } while (cursor);

    const holdersArray = Object.entries(holderCounts).map(([wallet, count]) => ({ wallet, count }));
    console.log(`[FetchNewHolders] Total unique holders: ${holdersArray.length}`);

    const dataToSave = {
      holders: holdersArray,
      last_updated: Date.now(),
    };
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(dataToSave, null, 2));
    console.log(`[FetchNewHolders] Data saved to ${OUTPUT_FILE}`);

  } catch (error) {
    console.error('[FetchNewHolders] Error fetching holders:', error);
  }
}

fetchNewNFTHolders();