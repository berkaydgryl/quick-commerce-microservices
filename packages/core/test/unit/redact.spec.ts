import { describe, expect, it } from 'vitest';

import { redactConnectionString } from '../../src/redact.js';

describe('redactConnectionString', () => {
  it('kullanici ve parolayi gizler', () => {
    expect(redactConnectionString('mongodb://admin:gizli@localhost:27017/getir')).toBe(
      'mongodb://***@localhost:27017/getir',
    );
  });

  it('yalnizca parola (redis) de gizlenir', () => {
    expect(redactConnectionString('redis://:gizli@localhost:6379')).toBe(
      'redis://***@localhost:6379',
    );
  });

  it('kimlik yoksa adres degismez', () => {
    expect(redactConnectionString('mongodb://localhost:27017/getir?directConnection=true')).toBe(
      'mongodb://localhost:27017/getir?directConnection=true',
    );
  });

  it('parolada @ varsa parolanin HICBIR parcasi kalmaz', () => {
    expect(redactConnectionString('redis://:p@ss@localhost:6379')).toBe(
      'redis://***@localhost:6379',
    );
    expect(redactConnectionString('mongodb://admin:a@b@c@db:27017/getir')).toBe(
      'mongodb://***@db:27017/getir',
    );
  });

  it('cok hostlu Mongo adresinde kimlik gizlenir, hostlar kalir', () => {
    expect(redactConnectionString('mongodb://u:gizli@h1:27017,h2:27017/getir?replicaSet=rs0')).toBe(
      'mongodb://***@h1:27017,h2:27017/getir?replicaSet=rs0',
    );
  });

  it('kimlikli adreste sorgudaki @ parolaya katilmaz', () => {
    expect(redactConnectionString('redis://:gizli@localhost:6379/0?name=a@b')).toBe(
      'redis://***@localhost:6379/0?name=a@b',
    );
  });

  it('yol icindeki @ kimlik sanilmaz', () => {
    // Ilk "/" ile "@" arasinda "/" varsa o bir kimlik bolumu degildir.
    expect(redactConnectionString('redis://localhost:6379/0?name=a@b')).toBe(
      'redis://localhost:6379/0?name=a@b',
    );
  });
});
