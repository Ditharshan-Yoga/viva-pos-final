import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests/e2e',workers:1,use:{baseURL:process.env.POS_URL||'http://127.0.0.1:8000',headless:true,launchOptions:{executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']},screenshot:'only-on-failure'},reporter:'list'});
