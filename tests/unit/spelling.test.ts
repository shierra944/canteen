import { describe, expect, it } from 'vitest';
import { fixCompletedWords, fixSpelling, fixWord } from '../../src/lib/spelling';

describe('automatic spelling correction', () => {
  it('corrects known misspelled English words', () => {
    expect(fixSpelling('recieved 2 gallons of watter')).toBe('received 2 gallons of water');
    expect(fixSpelling('Biscutis')).toBe('Biscuits');
    expect(fixSpelling('Canteen Sahre')).toBe('Canteen Share');
  });

  it('keeps the case the word was typed in', () => {
    expect(fixWord('RECIEVE')).toBe('RECEIVE');
    expect(fixWord('Recieve')).toBe('Receive');
    expect(fixWord('recieve')).toBe('receive');
  });

  it('never changes names, Filipino words or correct words', () => {
    const text = 'Chaii salary, pancit, ginaling, sabon, Renren, Sir Villaver, Judy Ann, longganiza, turon';
    expect(fixSpelling(text)).toBe(text);
    expect(fixSpelling('diner expanse meting neighbour judgement')).toBe('diner expanse meting neighbour judgement');
  });

  it('leaves a word alone until it is finished', () => {
    expect(fixCompletedWords('recieve')).toBe('recieve');
    expect(fixCompletedWords('recieve ')).toBe('receive ');
    expect(fixCompletedWords('recieve, watter')).toBe('receive, watter');
  });
});
