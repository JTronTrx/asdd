// middleware.ts (в корне проекта)

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-secret-key-change-this-in-production'
);

export async function middleware(request: NextRequest) {
  // Проверяем только админские роуты
  if (request.nextUrl.pathname.startsWith('/admin')) {
    // Пропускаем страницу логина
    if (request.nextUrl.pathname === '/admin/login') {
      return NextResponse.next();
    }

    // Получаем токен из куки
    const token = request.cookies.get('admin_token')?.value;

    if (!token) {
      // Редирект на логин если нет токена
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }

    try {
      // Проверяем токен
      await jwtVerify(token, JWT_SECRET);
      return NextResponse.next();
    } catch (error) {
      // Токен невалидный - редирект на логин
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/admin/:path*'
};