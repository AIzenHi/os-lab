// i18n 入口:React 钩子与非组件环境(结果图绘制)共用同一语言状态
import { useLab } from '../state/store';
import { STRINGS, type StringKey } from './strings';

let currentLang: 'zh' | 'en' = 'zh';

export function setI18nLang(lang: 'zh' | 'en'): void {
  currentLang = lang;
}

export function t(key: StringKey, params?: Record<string, string | number>): string {
  let s = STRINGS[currentLang][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}

export function useT(): (key: StringKey, params?: Record<string, string | number>) => string {
  const lang = useLab((s) => s.lang);
  setI18nLang(lang);
  return t;
}

export type { StringKey };
