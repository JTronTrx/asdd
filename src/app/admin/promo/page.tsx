// app/admin/promo/page.tsx
"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PromoCodeService, StatisticsService, PromoCode } from '@/lib/supabase';


export default function AdminPromoPage() {
  const router = useRouter();
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [statistics, setStatistics] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [newCodeForm, setNewCodeForm] = useState({
    prefix: 'TON',
    name: '',
    description: '',
    createdBy: 'Admin',
    maxUses: '',
    expiresInDays: ''
  });
  const [generatedCode, setGeneratedCode] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showOnlyActive, setShowOnlyActive] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      // Загружаем промокоды из БД
      const allCodes = await PromoCodeService.getAllCodes();
      setCodes(allCodes);
      
      // Загружаем статистику
      const stats = await StatisticsService.getOverallStatistics();
      setStatistics(stats);
    } catch (error) {
      console.error('Error loading data:', error);
      alert('Failed to load data from database');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateCode = async () => {
    if (!newCodeForm.name) {
      alert('Please fill in Name field');
      return;
    }

    setIsGenerating(true);

    try {
      const expiresAt = newCodeForm.expiresInDays 
        ? new Date(Date.now() + parseInt(newCodeForm.expiresInDays) * 24 * 60 * 60 * 1000)
        : undefined;

      // Создаем код в БД
      const code = await PromoCodeService.createCode({
        name: newCodeForm.name,
        description: newCodeForm.description,
        created_by: newCodeForm.createdBy,
        max_uses: newCodeForm.maxUses ? parseInt(newCodeForm.maxUses) : undefined,
        expires_at: expiresAt
      });

      setGeneratedCode(code);
      await loadData(); // Перезагружаем данные
      
      // Очищаем форму
      setNewCodeForm({
        prefix: 'TON',
        name: '',
        description: '',
        createdBy: 'Admin',
        maxUses: '',
        expiresInDays: ''
      });
    } catch (error) {
      console.error('Error generating code:', error);
      alert('Failed to generate code');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleToggleCode = async (code: string, currentStatus: boolean) => {
    try {
      await PromoCodeService.toggleCodeStatus(code, !currentStatus);
      await loadData(); // Перезагружаем данные
    } catch (error) {
      console.error('Error toggling code:', error);
      alert('Failed to update code status');
    }
  };

  const handleLogout = () => {
    // Удаляем куки
    document.cookie = 'admin_token=; path=/; max-age=0';
    router.push('/admin/login');
  };

  const filteredCodes = codes.filter(code => {
    const matchesSearch = code.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          code.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          code.created_by.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesActive = !showOnlyActive || code.is_active;
    return matchesSearch && matchesActive;
  });

  if (isLoading) {
    return (
      <div style={{ 
        padding: '20px', 
        textAlign: 'center', 
        fontSize: '20px',
        color: '#666'
      }}>
        Loading data from database...
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto', fontFamily: 'Manrope, sans-serif' }}>
      {/* Header с кнопкой выхода */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '30px' 
      }}>
        <h1 style={{ color: '#0098ea', margin: 0 }}>🎫 Promo Code Manager (Database Connected)</h1>
        <button
          onClick={handleLogout}
          style={{
            padding: '10px 20px',
            background: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          🚪 Logout
        </button>
      </div>

      {/* Statistics */}
      {statistics && (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
          gap: '20px', 
          marginBottom: '30px' 
        }}>
          <div style={{ 
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
            padding: '20px', 
            borderRadius: '12px', 
            color: 'white' 
          }}>
            <h3 style={{ margin: '0 0 10px 0' }}>Total Codes</h3>
            <p style={{ fontSize: '32px', fontWeight: 'bold', margin: 0 }}>{statistics.totalCodes}</p>
          </div>
          <div style={{ 
            background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', 
            padding: '20px', 
            borderRadius: '12px', 
            color: 'white' 
          }}>
            <h3 style={{ margin: '0 0 10px 0' }}>Active Codes</h3>
            <p style={{ fontSize: '32px', fontWeight: 'bold', margin: 0 }}>{statistics.activeCodes}</p>
          </div>
          <div style={{ 
            background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', 
            padding: '20px', 
            borderRadius: '12px', 
            color: 'white' 
          }}>
            <h3 style={{ margin: '0 0 10px 0' }}>Total Usage</h3>
            <p style={{ fontSize: '32px', fontWeight: 'bold', margin: 0 }}>{statistics.totalUsage}</p>
          </div>
          <div style={{ 
            background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', 
            padding: '20px', 
            borderRadius: '12px', 
            color: 'white' 
          }}>
            <h3 style={{ margin: '0 0 10px 0' }}>Unique Wallets</h3>
            <p style={{ fontSize: '32px', fontWeight: 'bold', margin: 0 }}>{statistics.uniqueWallets}</p>
          </div>
        </div>
      )}

      {/* Top Codes */}
      {statistics?.topPromoCodes && statistics.topPromoCodes.length > 0 && (
        <div style={{ 
          background: '#f8f9fa', 
          padding: '20px', 
          borderRadius: '12px', 
          marginBottom: '30px' 
        }}>
          <h3 style={{ marginBottom: '15px' }}>🏆 Top Performing Codes</h3>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            {statistics.topPromoCodes.map((code: any, index: number) => (
              <div key={code.code} style={{ 
                background: 'white', 
                padding: '10px 20px', 
                borderRadius: '8px',
                border: '2px solid #e0e0e0' 
              }}>
                <span style={{ fontSize: '20px', marginRight: '10px' }}>
                  {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏅'}
                </span>
                <strong>{code.code}</strong> ({code.name}) - {code.uses} uses
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generate New Code */}
      <div style={{ 
        background: 'white', 
        padding: '30px', 
        borderRadius: '12px', 
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        marginBottom: '30px' 
      }}>
        <h2 style={{ marginBottom: '20px' }}>Generate New Code</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
          <input
            type="text"
            placeholder="Name/Source *"
            value={newCodeForm.name}
            onChange={(e) => setNewCodeForm({...newCodeForm, name: e.target.value})}
            style={{ padding: '10px', borderRadius: '6px', border: '1px solid #ddd' }}
            required
          />
          <input
            type="text"
            placeholder="Description"
            value={newCodeForm.description}
            onChange={(e) => setNewCodeForm({...newCodeForm, description: e.target.value})}
            style={{ padding: '10px', borderRadius: '6px', border: '1px solid #ddd' }}
          />
          <input
            type="number"
            placeholder="Max Uses (optional)"
            value={newCodeForm.maxUses}
            onChange={(e) => setNewCodeForm({...newCodeForm, maxUses: e.target.value})}
            style={{ padding: '10px', borderRadius: '6px', border: '1px solid #ddd' }}
          />
          <input
            type="number"
            placeholder="Expires in days (optional)"
            value={newCodeForm.expiresInDays}
            onChange={(e) => setNewCodeForm({...newCodeForm, expiresInDays: e.target.value})}
            style={{ padding: '10px', borderRadius: '6px', border: '1px solid #ddd' }}
          />
        </div>
        <button
          onClick={handleGenerateCode}
          disabled={isGenerating}
          style={{ 
            marginTop: '20px',
            padding: '12px 30px',
            background: 'linear-gradient(180deg, #41b8de 0%, #0098ea 125.89%)',
            color: 'white',
            border: 'none',
            borderRadius: '50px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: isGenerating ? 'not-allowed' : 'pointer',
            transition: 'transform 0.2s',
            opacity: isGenerating ? 0.6 : 1
          }}
          onMouseOver={(e) => !isGenerating && (e.currentTarget.style.transform = 'translateY(-2px)')}
          onMouseOut={(e) => !isGenerating && (e.currentTarget.style.transform = 'translateY(0)')}
        >
          {isGenerating ? 'Generating...' : 'Generate Code'}
        </button>

        {generatedCode && (
          <div style={{ 
            marginTop: '20px', 
            padding: '20px', 
            background: '#d4edda', 
            borderRadius: '8px',
            border: '1px solid #c3e6cb' 
          }}>
            <strong>✅ Generated Code:</strong> 
            <span style={{ 
              fontSize: '24px', 
              fontWeight: 'bold', 
              color: '#155724',
              marginLeft: '10px',
              userSelect: 'all' 
            }}>
              {generatedCode}
            </span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(generatedCode);
                alert('Copied to clipboard!');
              }}
              style={{
                marginLeft: '20px',
                padding: '5px 15px',
                background: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              📋 Copy
            </button>
          </div>
        )}
      </div>

      {/* Search and Filter */}
      <div style={{ 
        display: 'flex', 
        gap: '20px', 
        marginBottom: '20px',
        alignItems: 'center' 
      }}>
        <input
          type="text"
          placeholder="Search codes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ 
            flex: 1,
            padding: '10px', 
            borderRadius: '6px', 
            border: '1px solid #ddd' 
          }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="checkbox"
            checked={showOnlyActive}
            onChange={(e) => setShowOnlyActive(e.target.checked)}
          />
          Show only active
        </label>
      </div>

      {/* Codes Table */}
      <div style={{ 
        background: 'white', 
        borderRadius: '12px', 
        overflow: 'hidden',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)' 
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8f9fa' }}>
              <th style={{ padding: '15px', textAlign: 'left' }}>Code</th>
              <th style={{ padding: '15px', textAlign: 'left' }}>Name/Source</th>
              <th style={{ padding: '15px', textAlign: 'left' }}>Created By</th>
              <th style={{ padding: '15px', textAlign: 'center' }}>Usage</th>
              <th style={{ padding: '15px', textAlign: 'center' }}>Max Uses</th>
              <th style={{ padding: '15px', textAlign: 'center' }}>Status</th>
              <th style={{ padding: '15px', textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredCodes.map((code) => (
              <tr key={code.code} style={{ borderBottom: '1px solid #e0e0e0' }}>
                <td style={{ padding: '15px' }}>
                  <strong style={{ fontFamily: 'monospace', fontSize: '14px' }}>
                    {code.code}
                  </strong>
                </td>
                <td style={{ padding: '15px' }}>
                  <div>
                    <strong>{code.name}</strong>
                    {code.description && (
                      <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
                        {code.description}
                      </div>
                    )}
                  </div>
                </td>
                <td style={{ padding: '15px' }}>{code.created_by}</td>
                <td style={{ padding: '15px', textAlign: 'center' }}>
                  <span style={{ 
                    padding: '4px 12px', 
                    background: '#e3f2fd', 
                    borderRadius: '20px',
                    fontSize: '14px',
                    fontWeight: 'bold' 
                  }}>
                    {code.usage_count}
                  </span>
                </td>
                <td style={{ padding: '15px', textAlign: 'center' }}>
                  {code.max_uses || '∞'}
                </td>
                <td style={{ padding: '15px', textAlign: 'center' }}>
                  <span style={{ 
                    padding: '4px 12px', 
                    background: code.is_active ? '#d4edda' : '#f8d7da',
                    color: code.is_active ? '#155724' : '#721c24',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 'bold' 
                  }}>
                    {code.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ padding: '15px', textAlign: 'center' }}>
                  <button
                    onClick={() => handleToggleCode(code.code, code.is_active)}
                    style={{
                      padding: '6px 16px',
                      background: code.is_active ? '#dc3545' : '#28a745',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    {code.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(code.code);
                      alert(`Copied: ${code.code}`);
                    }}
                    style={{
                      marginLeft: '8px',
                      padding: '6px 12px',
                      background: '#6c757d',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    📋
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{
        marginTop: '40px',
        padding: '20px',
        background: '#e7f3ff',
        borderRadius: '8px',
        border: '1px solid #0098ea'
      }}>
        <h4 style={{ margin: '0 0 10px 0', color: '#0098ea' }}>📊 Database Status</h4>
        <p style={{ margin: 0, color: '#666' }}>
          ✅ Connected to Supabase<br />
          ✅ Real-time data synchronization<br />
          ✅ All changes are saved automatically
        </p>
      </div>
    </div>
  );
}