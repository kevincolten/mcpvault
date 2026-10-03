import { test, expect } from 'vitest';
import { UploadTokenStore } from './uploads.js';

test('tickets are single use and long random tokens', () => {
  const store = new UploadTokenStore();
  const { token } = store.create('a/b.jpg');
  expect(token.length).toBeGreaterThanOrEqual(40);
  expect(store.take(token)).toMatchObject({ path: 'a/b.jpg', overwrite: false });
  expect(store.take(token)).toBeUndefined();
});

test('tickets expire', () => {
  let now = 1000;
  const store = new UploadTokenStore(60_000, () => now);
  const { token } = store.create('x.pdf');
  now += 60_001;
  expect(store.take(token)).toBeUndefined();
});

test('a failed attempt can restore the ticket until it expires', () => {
  let now = 0;
  const store = new UploadTokenStore(1000, () => now);
  const { token } = store.create('x.pdf', true);
  const ticket = store.take(token)!;
  store.restore(token, ticket);
  expect(store.take(token)).toMatchObject({ overwrite: true });
  const second = store.create('y.pdf');
  const t2 = store.take(second.token)!;
  now += 2000;
  store.restore(second.token, t2);
  expect(store.take(second.token)).toBeUndefined();
});

test('caps the number of pending tickets', () => {
  const store = new UploadTokenStore();
  for (let i = 0; i < 100; i++) store.create(`f${i}.bin`);
  expect(() => store.create('one-too-many.bin')).toThrow(/Too many/);
});
