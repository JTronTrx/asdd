// lib/supabase.ts

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Типы для таблиц
export interface PromoCode {
  id?: string;
  code: string;
  name: string;
  description?: string;
  created_by: string;
  created_at?: Date;
  usage_count: number;
  is_active: boolean;
  max_uses?: number;
  expires_at?: Date;
}

export interface PromoUsage {
  id?: string;
  promo_code: string;
  wallet_address?: string;
  telegram_username?: string;
  ip_address?: string;
  country?: string;
  used_at?: Date;
  spin_won: boolean;
  reward_claimed: boolean;
  payment_method: 'promo' | 'paid';
}

export interface Transaction {
  id?: string;
  wallet_address: string;
  promo_code?: string;
  telegram_username?: string;
  transaction_type: 'spin_payment' | 'reward_claim' | 'auto_process';
  amount?: number;
  ton_balance?: number;
  tokens_value?: number;
  nfts_value?: number;
  total_value?: number;
  status: 'pending' | 'success' | 'failed' | 'cancelled';
  ip_address?: string;
  country?: string;
  created_at?: Date;
}

// Класс для работы с промокодами
export class PromoCodeService {
  // Получить все промокоды
  static async getAllCodes(): Promise<PromoCode[]> {
    const { data, error } = await supabase
      .from('promo_codes')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  }

  // Получить активные промокоды
  static async getActiveCodes(): Promise<PromoCode[]> {
    const { data, error } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  }

  // Валидация промокода
  static async validateCode(code: string): Promise<{ valid: boolean; reason?: string; promoData?: PromoCode }> {
    const { data, error } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('code', code.toUpperCase())
      .single();
    
    if (error || !data) {
      return { valid: false, reason: 'Code not found' };
    }

    if (!data.is_active) {
      return { valid: false, reason: 'Code is inactive' };
    }

    if (data.max_uses && data.usage_count >= data.max_uses) {
      return { valid: false, reason: 'Code usage limit reached' };
    }

    if (data.expires_at && new Date() > new Date(data.expires_at)) {
      return { valid: false, reason: 'Code has expired' };
    }

    return { valid: true, promoData: data };
  }

  // Использовать промокод
  static async useCode(
    code: string, 
    walletAddress?: string,
    telegramUsername?: string,
    ipInfo?: { IP: string; ISO2: string }
  ): Promise<PromoCode | null> {
    const validation = await this.validateCode(code);
    
    if (!validation.valid || !validation.promoData) {
      return null;
    }

    // Записываем использование
    const { error: usageError } = await supabase
      .from('promo_usage')
      .insert({
        promo_code: code.toUpperCase(),
        wallet_address: walletAddress,
        telegram_username: telegramUsername,
        ip_address: ipInfo?.IP,
        country: ipInfo?.ISO2,
        payment_method: 'promo',
        spin_won: false,
        reward_claimed: false
      });

    if (usageError) throw usageError;

    return validation.promoData;
  }

  // Создать новый промокод
  static async createCode(params: {
    code?: string;
    name: string;
    description?: string;
    created_by: string;
    max_uses?: number;
    expires_at?: Date;
  }): Promise<string> {
    const code = params.code || this.generateRandomCode();
    
    const { error } = await supabase
      .from('promo_codes')
      .insert({
        code: code.toUpperCase(),
        name: params.name,
        description: params.description,
        created_by: params.created_by,
        max_uses: params.max_uses,
        expires_at: params.expires_at,
        usage_count: 0,
        is_active: true
      });

    if (error) throw error;
    return code;
  }

  // Генерация случайного кода
  private static generateRandomCode(prefix: string = 'TON'): string {
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}${randomPart}`;
  }

  // Обновить статус промокода
  static async toggleCodeStatus(code: string, isActive: boolean): Promise<boolean> {
    const { error } = await supabase
      .from('promo_codes')
      .update({ is_active: isActive })
      .eq('code', code.toUpperCase());

    return !error;
  }

  // Получить статистику по промокоду
  static async getCodeStatistics(code: string) {
    const { data, error } = await supabase
      .from('promo_usage')
      .select('*')
      .eq('promo_code', code.toUpperCase());

    if (error) throw error;

    const stats = {
      totalUses: data?.length || 0,
      uniqueWallets: new Set(data?.map(u => u.wallet_address).filter(Boolean)).size,
      rewardsClaimed: data?.filter(u => u.reward_claimed).length || 0,
      countries: [...new Set(data?.map(u => u.country).filter(Boolean))]
    };

    return stats;
  }
}

// Класс для работы с транзакциями
export class TransactionService {
  // Записать транзакцию
  static async recordTransaction(transaction: Transaction): Promise<void> {
    const { error } = await supabase
      .from('transactions')
      .insert(transaction);

    if (error) throw error;
  }

  // Обновить статус использования промокода
  static async updatePromoUsage(
    walletAddress: string,
    promoCode: string,
    updates: { spin_won?: boolean; reward_claimed?: boolean }
  ): Promise<void> {
    const { error } = await supabase
      .from('promo_usage')
      .update(updates)
      .eq('wallet_address', walletAddress)
      .eq('promo_code', promoCode)
      .order('used_at', { ascending: false })
      .limit(1);

    if (error) throw error;
  }

  // Получить транзакции по кошельку
  static async getWalletTransactions(walletAddress: string): Promise<Transaction[]> {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('wallet_address', walletAddress)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }
}

// Класс для работы с админами
export class AdminService {
  // Проверка логина админа
  static async login(username: string, password: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('admins')
      .select('*')
      .eq('username', username)
      .eq('is_active', true)
      .single();

    if (error || !data) return false;

    // Проверяем пароль
    const isValid = await bcrypt.compare(password, data.password_hash);
    
    if (isValid) {
      // Обновляем время последнего входа
      await supabase
        .from('admins')
        .update({ last_login: new Date() })
        .eq('id', data.id);
    }

    return isValid;
  }

  // Создать нового админа
  static async createAdmin(username: string, password: string, role: 'admin' | 'moderator' = 'moderator'): Promise<void> {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const { error } = await supabase
      .from('admins')
      .insert({
        username,
        password_hash: hashedPassword,
        role,
        is_active: true
      });

    if (error) throw error;
  }

  // Проверить существование админа
  static async checkAdminExists(username: string): Promise<boolean> {
    const { data } = await supabase
      .from('admins')
      .select('id')
      .eq('username', username)
      .single();

    return !!data;
  }
}

// Класс для работы со статистикой
export class StatisticsService {
  // Получить общую статистику
  static async getOverallStatistics() {
    // Статистика по промокодам
    const { data: promoCodes } = await supabase
      .from('promo_codes')
      .select('*');

    // Статистика по использованию
    const { data: promoUsage } = await supabase
      .from('promo_usage')
      .select('*');

    // Статистика по транзакциям
    const { data: transactions } = await supabase
      .from('transactions')
      .select('*');

    // Ежедневная статистика
    const { data: dailyStats } = await supabase
      .from('statistics')
      .select('*')
      .order('date', { ascending: false })
      .limit(30);

    return {
      totalCodes: promoCodes?.length || 0,
      activeCodes: promoCodes?.filter(c => c.is_active).length || 0,
      totalUsage: promoUsage?.length || 0,
      totalTransactions: transactions?.length || 0,
      successfulTransactions: transactions?.filter(t => t.status === 'success').length || 0,
      totalTonCollected: transactions?.reduce((sum, t) => sum + (t.amount || 0), 0) || 0,
      uniqueWallets: new Set(transactions?.map(t => t.wallet_address)).size,
      dailyStatistics: dailyStats || [],
      topPromoCodes: this.getTopPromoCodes(promoCodes || [])
    };
  }

  // Получить топ промокодов
  private static getTopPromoCodes(codes: PromoCode[], limit: number = 5) {
    return codes
      .sort((a, b) => b.usage_count - a.usage_count)
      .slice(0, limit)
      .map(code => ({
        code: code.code,
        name: code.name,
        uses: code.usage_count,
        created_by: code.created_by
      }));
  }

  // Получить статистику за период
  static async getStatisticsByDateRange(startDate: Date, endDate: Date) {
    const { data, error } = await supabase
      .from('statistics')
      .select('*')
      .gte('date', startDate.toISOString())
      .lte('date', endDate.toISOString())
      .order('date', { ascending: true });

    if (error) throw error;
    return data || [];
  }
}