import { describe, expect, it } from 'vitest';
import { AppError, errorMessage, withNetwork } from '../../src/shared/errors';
import {
  normalizePhone,
  validateEmail,
  validateFullName,
  validateUsername,
} from '../../src/shared/validation';

describe('normalizePhone', () => {
  it('понимает разные записи польского номера', () => {
    for (const value of ['500100200', '500 100 200', '500-100-200', '+48 500 100 200', '0048500100200', '+48 (500) 100-200']) {
      expect(normalizePhone(value)).toBe('+48500100200');
    }
  });

  it('оставляет другие страны как есть', () => {
    expect(normalizePhone('+380 50 123 45 67')).toBe('+380501234567');
  });

  it('отклоняет мусор', () => {
    for (const value of ['', '+48 ', '123', 'abc', '+48 500 100 200 300 400', '+0123456789']) {
      expect(normalizePhone(value)).toBeNull();
    }
  });
});

describe('поля регистрации', () => {
  it('имя пользователя', () => {
    expect(validateUsername('Jan_K.92')).toBeNull();
    expect(validateUsername('ab')).not.toBeNull();
    expect(validateUsername('имя')).not.toBeNull();
    expect(validateUsername('with space')).not.toBeNull();
    expect(validateUsername('x'.repeat(25))).not.toBeNull();
    expect(validateUsername('../admin')).not.toBeNull();
  });

  it('ФИО', () => {
    expect(validateFullName('Иван Иванов')).toBeNull();
    expect(validateFullName('  ')).not.toBeNull();
    expect(validateFullName('x'.repeat(101))).not.toBeNull();
  });

  it('почта', () => {
    expect(validateEmail('a@b.pl')).toBeNull();
    expect(validateEmail('a@b')).not.toBeNull();
    expect(validateEmail('a b@c.pl')).not.toBeNull();
    expect(validateEmail('')).not.toBeNull();
  });
});

describe('ошибки', () => {
  it('переводит коды Firebase', () => {
    expect(errorMessage({ code: 'auth/invalid-verification-code' })).toBe('Неверный код из SMS.');
  });

  it('показывает готовый текст AppError', () => {
    expect(errorMessage(new AppError('Текст'))).toBe('Текст');
  });

  it('неизвестная ошибка не показывает технические детали', () => {
    expect(errorMessage(new Error('secret stack'))).not.toContain('secret');
  });

  it('withNetwork не ждёт бесконечно', async () => {
    await expect(withNetwork(() => new Promise(() => undefined), 10)).rejects.toBeInstanceOf(AppError);
  });

  it('withNetwork возвращает результат', async () => {
    await expect(withNetwork(async () => 5)).resolves.toBe(5);
  });
});
