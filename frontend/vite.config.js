import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 plugins:[react()],resolve:{alias:{'@':fileURLToPath(new URL('./src/mobile',import.meta.url))}},
 build:{rollupOptions:{input:{web:fileURLToPath(new URL('./index.html',import.meta.url)),mobile:fileURLToPath(new URL('./mobile/index.html',import.meta.url))}}},
 server:{host:'0.0.0.0',port:5173,strictPort:true,proxy:{'/api-server':{target:process.env.ENVIA_API_PROXY_TARGET||'http://backend:8000',changeOrigin:true,rewrite:path=>path.replace(/^\/api-server/,'')}}}
});
